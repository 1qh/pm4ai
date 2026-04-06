/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
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
      const text = chunk.toString()
      if (text.includes('Ready')) {
        clearTimeout(timeout)
        resolve()
      }
    })
    server.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      if (text.includes('Ready')) {
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
const rpc = async (procedure: string, body: unknown = [], input?: unknown) => {
  const payload = input === undefined ? body : { json: input }
  const res = await fetch(`${baseUrl}/api/rpc/${procedure}`, {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST'
  })
  return { json: await res.json(), status: res.status }
}
describe('API endpoints', () => {
  test('projects returns array', async () => {
    const { json, status } = await rpc('projects')
    expect(status).toBe(200)
    expect(json).toHaveProperty('json')
    expect(Array.isArray((json as Record<string, unknown>).json)).toBe(true)
  })
  test('projects include pm4ai', async () => {
    const { json } = await rpc('projects')
    const projects = (json as Record<string, { name: string }[]>).json
    expect(projects.some(p => p.name === 'pm4ai')).toBe(true)
  })
  test('projects have checkResult field', async () => {
    const { json } = await rpc('projects')
    const projects = (json as Record<string, { checkResult: unknown }[]>).json
    for (const p of projects) expect(p).toHaveProperty('checkResult')
  })
  test('projects have name and path', async () => {
    const { json } = await rpc('projects')
    const projects = (json as Record<string, { name: string; path: string }[]>).json
    for (const p of projects) {
      expect(p.name).toBeTruthy()
      expect(p.path).toBeTruthy()
      expect(p.path.startsWith('/')).toBe(true)
    }
  })
  test('projects exclude /tmp paths', async () => {
    const { json } = await rpc('projects')
    const projects = (json as Record<string, { path: string }[]>).json
    expect(projects.every(p => !p.path.startsWith('/tmp/'))).toBe(true)
  })
  test('socketStatus returns connected boolean', async () => {
    const { json, status } = await rpc('socketStatus')
    expect(status).toBe(200)
    expect((json as Record<string, Record<string, boolean>>).json.connected).toBe(false)
  })
  test('fixAll without auth returns error', async () => {
    const { json, status } = await rpc('fixAll', undefined, { all: true })
    expect(status).toBe(500)
    expect((json as Record<string, Record<string, string>>).json.message).toBe('Internal server error')
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
    const data = (json as Record<string, Record<string, unknown>>).json
    expect(data.name).toBe('pm4ai')
    expect(data.path).toBeTruthy()
  })
  test('projectStatus for unknown returns null', async () => {
    const { json, status } = await rpc('projectStatus', undefined, { project: 'nonexistent-project' })
    expect(status).toBe(200)
    expect((json as Record<string, unknown>).json).toBeNull()
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
})
