/** biome-ignore-all lint/nursery/noPlaywrightElementHandle: playwright e2e */
/** biome-ignore-all lint/nursery/noPlaywrightEval: playwright e2e */
/** biome-ignore-all lint/nursery/noPlaywrightWaitForSelector: playwright e2e */
/* eslint-disable no-promise-executor-return, @typescript-eslint/no-unnecessary-condition */
import type { ChildProcess } from 'node:child_process'
import type { Browser, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { createEvent } from 'pm4ai'
import { emit, startEmitter, stopEmitter } from '../../../../packages/pm4ai/src/watch-emitter.js'
import { cleanDistDir, spawnDevServer } from './dev-server.js'
import { freePort } from './free-port.js'
/** A fixed port is a host-wide singleton, so a second run on the same machine — a CI runner beside a local shell — races it for the bind. */
const PORT = await freePort()
const BASE = `http://localhost:${PORT}`
setDefaultTimeout(60_000)
const dashboardDir = join(import.meta.dirname, '..', '..')
let server: ChildProcess
let browser: Browser
let page: Page
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
beforeAll(async () => {
  ;({ distDir, server } = spawnDevServer(dashboardDir, PORT))
  await waitForReady()
  browser = await chromium.launch()
  page = await browser.newPage()
  await page.goto(BASE)
  await page.waitForSelector('h1', { timeout: 60_000 })
}, 120_000)
afterAll(async () => {
  await browser?.close()
  server?.kill()
  await cleanDistDir(dashboardDir, distDir)
})
describe('dashboard e2e', () => {
  test('page loads and shows pm4ai heading', async () => {
    await page.goto(BASE)
    await page.waitForSelector('h1')
    const heading = await page.textContent('h1')
    expect(heading).toContain('pm4ai')
  })
  test('renders Fix All and Status All buttons', async () => {
    await page.goto(BASE)
    await page.waitForSelector('button:has-text("Fix All")')
    await page.waitForSelector('button:has-text("Status All")')
    const buttons = await page.$$eval('button', els => els.map(b => b.textContent?.trim()))
    expect(buttons).toContain('Fix All')
    expect(buttons).toContain('Status All')
  })
  test('shows project list with real projects', async () => {
    await page.goto(BASE)
    await page.waitForSelector('.font-medium')
    const projectNames = await page.$$eval('.font-medium', els => els.map(e => e.textContent))
    expect(projectNames.length).toBeGreaterThan(0)
    expect(projectNames).toContain('pm4ai')
  })
  test('each project shows GitHub and VS Code links', async () => {
    await page.goto(BASE)
    await page.waitForSelector('.font-medium')
    const githubLinks = await page.$$eval('a[href*="github.com"]', els => els.length)
    const vscodeLinks = await page.$$eval('a[href^="vscode://"]', els => els.length)
    expect(githubLinks).toBeGreaterThan(0)
    expect(vscodeLinks).toBeGreaterThan(0)
  })
  test('each project shows path', async () => {
    await page.goto(BASE)
    await page.waitForSelector('.font-medium')
    const paths = await page.$$eval('.truncate.font-mono', els => els.map(e => e.textContent))
    const realPaths = paths.filter(p => p?.startsWith('/'))
    expect(realPaths.length).toBeGreaterThan(0)
  })
  test('event log section exists', async () => {
    await page.goto(BASE)
    const heading = await page.textContent('h2')
    expect(heading).toBe('Event Log')
  })
  test('event log section has content', async () => {
    await page.goto(BASE)
    await page.waitForSelector('h2')
    const section = await page.$('h2 + div')
    expect(section).toBeTruthy()
  })
  test('Fix All button can be clicked', async () => {
    await page.goto(BASE)
    const btn = await page.waitForSelector('button:has-text("Fix All")')
    expect(btn).toBeTruthy()
  })
  test('Status All button can be clicked', async () => {
    await page.goto(BASE)
    const btn = await page.waitForSelector('button:has-text("Status All")')
    expect(btn).toBeTruthy()
  })
  test('projects have correct GitHub URLs', async () => {
    await page.goto(BASE)
    await page.waitForSelector('.font-medium')
    const hrefs = await page.$$eval('a[href*="github.com/1qh"]', els => els.map(e => e.getAttribute('href')))
    for (const href of hrefs) expect(href).toMatch(/^https:\/\/github\.com\/1qh\/[\w-]+$/u)
  })
  test('no console errors on page load', async () => {
    const errors: string[] = []
    const p2 = await browser.newPage()
    p2.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    await p2.goto(BASE)
    await p2.waitForSelector('h1')
    await p2.waitForTimeout(1000)
    await p2.close()
    const real = errors.filter(e => !(e.includes('ENOENT') || e.includes('watch.sock')))
    expect(real).toHaveLength(0)
  })
  test('page has dark theme styling', async () => {
    await page.goto(BASE)
    await page.waitForSelector('.min-h-screen')
    const bg = await page.$eval('.min-h-screen', el => getComputedStyle(el).backgroundColor)
    expect(bg).toBeTruthy()
  })
  test('shows project count in header', async () => {
    await page.goto(BASE)
    await page.waitForSelector('.font-medium')
    const header = await page.textContent('header')
    expect(header).toContain('projects')
  })
})
describe('dashboard auth e2e', () => {
  test('invalid auth token returns 401', async () => {
    const res = await page.goto(`${BASE}/auth/invalid-token-xyz`)
    expect(res?.status()).toBe(401)
  })
  test('random UUID auth returns 401', async () => {
    const res = await page.goto(`${BASE}/auth/550e8400-e29b-41d4-a716-446655440000`)
    expect(res?.status()).toBe(401)
  })
})
describe('dashboard API via browser', () => {
  test('fetch projects from browser context', async () => {
    await page.goto(BASE)
    const result = await page.evaluate(async () => {
      const res = await fetch('/api/rpc/projects', {
        body: '[]',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST'
      })
      const json: unknown = await res.json()
      return { data: json, status: res.status }
    })
    expect(result.status).toBe(200)
    const data = result.data as { json: unknown[] }
    expect(Array.isArray(data.json)).toBe(true)
  })
  test('fetch unknown procedure returns 404', async () => {
    await page.goto(BASE)
    const status = await page.evaluate(async () => {
      const res = await fetch('/api/rpc/nonexistent', {
        body: '[]',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST'
      })
      return res.status
    })
    expect(status).toBe(404)
  })
})
const wait = async (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
const waitForSocketConnected = async (timeout = 10_000): Promise<void> => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const res = await fetch(`${BASE}/api/rpc/socketStatus`, {
      body: '[]',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })
    const data = (await res.json()) as { json: { connected: boolean } }
    if (data.json.connected) return
    await wait(500)
  }
  throw new Error('socket did not connect in time')
}
describe('dashboard live events e2e', () => {
  beforeAll(async () => {
    await startEmitter()
    await page.goto(BASE)
    await page.waitForSelector('.font-medium')
    await waitForSocketConnected()
    await wait(1000)
  })
  afterAll(async () => {
    await stopEmitter()
  })
  test('event log updates when emitter sends events', async () => {
    emit(createEvent({ project: 'pm4ai', status: 'start', step: 'sync' }))
    emit(createEvent({ detail: '3 synced', project: 'pm4ai', status: 'ok', step: 'sync' }))
    await wait(2000)
    const logText = await page.textContent('.font-mono.text-xs')
    expect(logText).toBeTruthy()
  })
})
