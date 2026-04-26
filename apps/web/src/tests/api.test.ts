/** biome-ignore-all lint/performance/noAwaitInLoops: sequential test */
import type { ChildProcess } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
const dashboardDir = join(import.meta.dirname, '..', '..')
let server: ChildProcess
let baseUrl: string
const waitForReady = async (): Promise<void> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server did not start')), 15_000)
    server.stderr?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('Ready')) {
        clearTimeout(timeout)
        resolve()
      }
    })
    server.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('Ready')) {
        clearTimeout(timeout)
        resolve()
      }
    })
  })
beforeAll(async () => {
  baseUrl = 'http://localhost:4201'
  server = spawn('bun', ['run', 'next', 'dev', '--port', '4201'], {
    cwd: dashboardDir,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  await waitForReady()
})
afterAll(() => {
  server.kill()
})
interface ProjectEntry {
  checkResult: null | { at: string; pass: boolean; violations: number }
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
  const json = (await res.json()) as RpcResponse
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
    expect(projects.every(p => !p.path.startsWith('/tmp/'))).toBe(true)
  })
  test('socketStatus returns connected boolean', async () => {
    const { json, status } = await rpc('socketStatus')
    expect(status).toBe(200)
    const data = json.json as unknown as { connected: boolean }
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
    const data = json.json as unknown as { name: string; path: string }
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
