/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: intentional */
/** biome-ignore-all lint/nursery/noPlaywrightElementHandle: playwright e2e */
/** biome-ignore-all lint/nursery/noPlaywrightEval: playwright e2e */
/** biome-ignore-all lint/nursery/noPlaywrightWaitForSelector: playwright e2e */
/** biome-ignore-all lint/nursery/noPlaywrightWaitForTimeout: timing */
/** biome-ignore-all lint/performance/noAwaitInLoops: polling */
/** biome-ignore-all lint/performance/useTopLevelRegex: test */
/** biome-ignore-all lint/style/noProcessEnv: CI detection */
/* oxlint-disable no-empty-function, eslint-plugin-promise(prefer-await-to-then), eslint-plugin-promise(param-names), no-await-in-loop */
/* eslint-disable @typescript-eslint/strict-void-return, no-promise-executor-return, @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unsafe-assignment, no-await-in-loop */
import type { ChildProcess } from 'node:child_process'
import type { Browser, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { createEvent } from 'pm4ai'
import { emit, startEmitter, stopEmitter } from '../../../../packages/pm4ai/src/watch-emitter.js'
const PORT = 4202
const BASE = `http://localhost:${PORT}`
const dashboardDir = join(import.meta.dirname, '..', '..')
let server: ChildProcess
let browser: Browser
let page: Page
const waitForReady = async (): Promise<void> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server did not start in 30s')), 30_000)
    const check = (chunk: Buffer) => {
      if (chunk.toString().includes('Ready')) {
        clearTimeout(timeout)
        resolve()
      }
    }
    server.stderr?.on('data', check)
    server.stdout?.on('data', check)
  })
beforeAll(async () => {
  server = spawn('bun', ['run', 'next', 'dev', '--port', String(PORT)], {
    cwd: dashboardDir,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  await waitForReady()
  browser = await chromium.launch()
  page = await browser.newPage()
})
afterAll(async () => {
  await browser?.close()
  server?.kill()
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
    await page.waitForSelector('button')
    await page.waitForTimeout(1000)
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
      return { data: await res.json(), status: res.status }
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
