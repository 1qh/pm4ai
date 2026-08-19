import type { ChildProcess } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { join } from 'node:path'
import { parseJson } from '../lib/json'
import { cleanDistDir, spawnDevServer } from './dev-server.js'
import { freePort } from './free-port.js'

const dashboardDir = join(import.meta.dirname, '..', '..')
setDefaultTimeout(60_000)
/** A fixed port is a host-wide singleton, so a second run on the same machine — a CI runner beside a local shell — races it for the bind. */
const PORT = await freePort()
let server: ChildProcess
let baseUrl: string
let distDir: string
/** Reports what the server actually said — a bare timeout hides the cause (port taken, crash on boot) behind one useless string. */
const waitForReady = async (): Promise<void> =>
  new Promise((resolve, reject) => {
    let output = ''
    const fail = (why: string) => reject(new Error(`${why}\n--- server output ---\n${output.trim() || '(silent)'}`))
    const timeout = setTimeout(() => fail(`server did not print "Ready" within 30s on port ${String(PORT)}`), 30_000)
    const check = (chunk: Buffer) => {
      output += chunk.toString()
      if (output.includes('Ready')) {
        clearTimeout(timeout)
        resolve()
      }
    }
    server.stderr?.on('data', check)
    server.stdout?.on('data', check)
    server.on('error', spawnError => {
      clearTimeout(timeout)
      fail(`server failed to spawn: ${spawnError.message}`)
    })
    server.on('exit', (code, signal) => {
      clearTimeout(timeout)
      fail(`server exited before becoming ready (code ${String(code)}, signal ${String(signal)})`)
    })
  })
const isJson = (body: string): boolean => {
  try {
    JSON.parse(body)
    return true
  } catch {
    return false
  }
}
/** `next dev` compiles a route on its FIRST request, so a warmup that swallows its own result lets the first real test hit a route mid-compile and read an HTML error page as JSON. Waits until the route actually answers with JSON, and fails loud with the last body when it never does. */
const warmRoute = async (): Promise<void> => {
  const deadline = Date.now() + 90_000
  let last = '(no response)'
  while (Date.now() < deadline) {
    const body = await fetch(`${baseUrl}/api/rpc/projects`, {
      body: '{}',
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    })
      .then(async res => res.text())
      .catch((error: unknown) => `fetch failed: ${String(error)}`)
    last = body
    if (isJson(body)) return
    await Bun.sleep(500)
  }
  throw new Error(`/api/rpc/projects never returned JSON within 90s\n--- last body ---\n${last.slice(0, 500)}`)
}
beforeAll(async () => {
  baseUrl = `http://localhost:${String(PORT)}`
  ;({ distDir, server } = spawnDevServer(dashboardDir, PORT))
  await waitForReady()
  await warmRoute()
}, 120_000)
afterAll(async () => {
  server.kill()
  await cleanDistDir(dashboardDir, distDir)
})
interface ProjectEntry {
  checkResult: null | { at: string; pass: boolean; violations: number }
  name: string
  path: string
}
interface ProjectStatusResponse {
  name: string
  path: string
}
interface RpcResponse {
  connected?: boolean
  json?: ProjectEntry[]
  message?: string
  name?: string
  path?: string
}
interface SocketStatusResponse {
  connected: boolean
}
const rpc = async (
  procedure: string,
  body: unknown = [],
  input?: unknown
): Promise<{ json: RpcResponse; status: number }> => {
  const payload = input === undefined ? body : { json: input }
  const res = await fetch(`${baseUrl}/api/rpc/${procedure}`, {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST'
  })
  const json = parseJson<RpcResponse>(await res.text())
  return { json, status: res.status }
}
describe('API endpoints', () => {
  test('projects returns array', async () => {
    const { json, status } = await rpc('projects')
    expect(status).toBe(200)
    expect(json).toHaveProperty('json')
    expect(Array.isArray(json.json)).toBe(true)
  })
  test('projects include pm4ai', async () => {
    const { json } = await rpc('projects')
    const projects = json.json ?? []
    expect(projects.some(p => p.name === 'pm4ai')).toBe(true)
  })
  test('projects have checkResult field', async () => {
    const { json } = await rpc('projects')
    const projects = json.json ?? []
    for (const p of projects) expect(p).toHaveProperty('checkResult')
  })
  test('projects have name and path', async () => {
    const { json } = await rpc('projects')
    const projects = json.json ?? []
    for (const p of projects) {
      expect(p.name).toBeTruthy()
      expect(p.path).toBeTruthy()
      expect(p.path.startsWith('/')).toBe(true)
    }
  })
  test('projects exclude /tmp paths', async () => {
    const { json } = await rpc('projects')
    const projects = json.json ?? []
    // eslint-disable-next-line sonarjs/publicly-writable-directories -- asserting the product excludes /tmp project paths
    expect(projects.every(p => !p.path.startsWith('/tmp/'))).toBe(true)
  })
  test('socketStatus returns connected boolean', async () => {
    const { json, status } = await rpc('socketStatus')
    expect(status).toBe(200)
    /** biome-ignore lint/nursery/noUnsafeTypeAssertion: RPC procedure response is narrowed by the procedure under test */
    const data = json.json as unknown as SocketStatusResponse
    expect(data.connected).toBe(false)
  })
  test('fixAll without auth returns error', async () => {
    const { status } = await rpc('fixAll', undefined, { all: true })
    expect(status).toBe(500)
  })
  test('refreshStatus without auth returns error', async () => {
    const { status } = await rpc('refreshStatus', undefined, { all: true })
    expect(status).toBe(500)
  })
  test('fixProject without auth returns error', async () => {
    const { status } = await rpc('fixProject', undefined, { project: 'pm4ai' })
    expect(status).toBe(500)
  })
  test('projectStatus returns project data', async () => {
    const { json, status } = await rpc('projectStatus', undefined, { project: 'pm4ai' })
    expect(status).toBe(200)
    /** biome-ignore lint/nursery/noUnsafeTypeAssertion: RPC procedure response is narrowed by the procedure under test */
    const data = json.json as unknown as ProjectStatusResponse
    expect(data.name).toBe('pm4ai')
    expect(data.path).toBeTruthy()
  })
  test('projectStatus for unknown returns null', async () => {
    const { json, status } = await rpc('projectStatus', undefined, { project: 'nonexistent-project' })
    expect(status).toBe(200)
    expect(json.json).toBeNull()
  })
  test('unknown procedure returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/rpc/nonexistent`, {
      body: '[]',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })
    expect(res.status).toBe(404)
  })
})
describe('Auth endpoints', () => {
  test('invalid token returns 401', async () => {
    const res = await fetch(`${baseUrl}/auth/invalid-token`, { redirect: 'manual' })
    expect(res.status).toBe(401)
  })
  test('empty token path returns non-200', async () => {
    const res = await fetch(`${baseUrl}/auth/`, { redirect: 'manual' })
    expect(res.status).not.toBe(200)
  })
  test('random UUID returns 401', async () => {
    const res = await fetch(`${baseUrl}/auth/550e8400-e29b-41d4-a716-446655440000`, { redirect: 'manual' })
    expect(res.status).toBe(401)
  })
})
describe('Page', () => {
  test('root page returns 200', async () => {
    const res = await fetch(baseUrl)
    expect(res.status).toBe(200)
  })
  test('root page contains pm4ai', async () => {
    const res = await fetch(baseUrl)
    const html = await res.text()
    expect(html).toContain('pm4ai')
  })
  test('root page is HTML', async () => {
    const res = await fetch(baseUrl)
    expect(res.headers.get('content-type')).toContain('text/html')
  })
  test('root page loads client bundle', async () => {
    const res = await fetch(baseUrl)
    const html = await res.text()
    expect(html).toContain('script')
  })
})
describe('Auth flow security', () => {
  test('multiple invalid tokens all return 401', async () => {
    const { randomUUID } = await import('node:crypto')
    for (let i = 0; i < 5; i += 1) {
      const res = await fetch(`${baseUrl}/auth/${randomUUID()}`, { redirect: 'manual' })
      expect(res.status).toBe(401)
    }
  })
  test('auth endpoint returns no token in response body', async () => {
    const res = await fetch(`${baseUrl}/auth/some-token`, { redirect: 'manual' })
    const body = await res.text()
    expect(body).not.toContain('some-token')
  })
})
describe('API error handling', () => {
  test('GET on mutation endpoint does not return 200', async () => {
    const res = await fetch(`${baseUrl}/api/rpc/fixAll`)
    expect(res.status).not.toBe(200)
  })
  test('malformed JSON body returns error', async () => {
    const res = await fetch(`${baseUrl}/api/rpc/projects`, {
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
  test('empty body on projects still works', async () => {
    const res = await fetch(`${baseUrl}/api/rpc/projects`, {
      body: '[]',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })
    expect(res.status).toBe(200)
  })
})
