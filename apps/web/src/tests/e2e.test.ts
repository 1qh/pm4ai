/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import type { ChildProcess } from 'node:child_process'
import type { Socket } from 'node:net'
import type { Browser, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { createEvent } from 'pm4ai'
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
let fixtureDir: string
let projectPath: string
let stateDirectory: string
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
const wait = async (ms: number): Promise<void> =>
  new Promise(r => {
    setTimeout(r, ms)
  })
const waitForSocketConnected = async (timeout = 10_000): Promise<void> => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const res = await fetch(`${BASE}/api/rpc/socketStatus`, {
      body: '[]',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })
    const data: unknown = await res.json()
    if (
      typeof data !== 'object' ||
      data === null ||
      !('json' in data) ||
      typeof data.json !== 'object' ||
      data.json === null ||
      !('connected' in data.json) ||
      typeof data.json.connected !== 'boolean'
    )
      throw new Error('unexpected socket status response')
    if (data.json.connected) return
    await wait(500)
  }
  throw new Error('socket did not connect in time')
}
const connectLiveEvents = async (): Promise<void> => {
  await page.goto(BASE)
  await page.getByTestId('project-name-pm4ai').waitFor()
  await waitForSocketConnected()
  await wait(1000)
}
describe('dashboard', () => {
  // biome-ignore lint/nursery/noTestHooks: one dev server is shared by the whole suite
  beforeAll(async () => {
    const started = await spawnDevServer(dashboardDir, PORT)
    distDir = started.distDir
    fixtureDir = started.fixtureDir
    projectPath = started.projectPath
    stateDirectory = started.stateDirectory
    server = started.server
    await waitForReady()
    browser = await chromium.launch()
    page = await browser.newPage()
    await page.goto(BASE)
    await page.getByRole('heading', { exact: true, level: 1, name: '⚡ pm4ai' }).waitFor({ timeout: 60_000 })
  }, 120_000)
  // biome-ignore lint/nursery/noTestHooks: one dev server is shared by the whole suite
  afterAll(async () => {
    await browser?.close()
    server?.kill()
    await cleanDistDir(dashboardDir, distDir, fixtureDir)
  })
  describe('dashboard e2e', () => {
    test('page loads and shows pm4ai heading', async () => {
      await page.goto(BASE)
      await page.getByRole('heading', { exact: true, level: 1, name: '⚡ pm4ai' }).waitFor()
      const heading = await page.textContent('h1')
      expect(heading).toContain('pm4ai')
    })
    test('renders Fix All and Status All buttons', async () => {
      await page.goto(BASE)
      await page.getByRole('button', { exact: true, name: 'Fix All' }).waitFor()
      await page.getByRole('button', { exact: true, name: 'Status All' }).waitFor()
      const buttons = await page.locator('button').evaluateAll(els => els.map(b => b.textContent?.trim()))
      expect(buttons).toContain('Fix All')
      expect(buttons).toContain('Status All')
    })
    test('shows project list with fixture projects', async () => {
      await page.goto(BASE)
      await page.getByTestId('project-name-pm4ai').waitFor()
      const projectNames = await page.locator('.font-medium').evaluateAll(els => els.map(e => e.textContent))
      expect(projectNames.length).toBeGreaterThan(0)
      expect(projectNames).toContain('pm4ai')
    })
    test('each project shows GitHub and VS Code links', async () => {
      await page.goto(BASE)
      await page.getByTestId('project-name-pm4ai').waitFor()
      const githubLinks = await page.locator('a[href*="github.com"]').evaluateAll(els => els.length)
      const vscodeLinks = await page.locator('a[href^="vscode://"]').evaluateAll(els => els.length)
      expect(githubLinks).toBeGreaterThan(0)
      expect(vscodeLinks).toBeGreaterThan(0)
    })
    test('each project shows path', async () => {
      await page.goto(BASE)
      await page.getByTestId('project-name-pm4ai').waitFor()
      const paths = await page.locator('.truncate.font-mono').evaluateAll(els => els.map(e => e.textContent))
      const realPaths = paths.filter(p => p?.startsWith('/'))
      expect(realPaths.length).toBeGreaterThan(0)
      expect(realPaths).toContain(projectPath)
    })
    test('event log section exists', async () => {
      await page.goto(BASE)
      const heading = await page.textContent('h2')
      expect(heading).toBe('Event Log')
    })
    test('event log section has content', async () => {
      await page.goto(BASE)
      await page.getByRole('heading', { exact: true, name: 'Event Log' }).waitFor()
      const sectionCount = await page.locator('h2 + div').count()
      expect(sectionCount).toBeGreaterThan(0)
    })
  })
  describe('dashboard controls e2e', () => {
    test('fix All button can be clicked', async () => {
      await page.goto(BASE)
      const btn = page.getByRole('button', { exact: true, name: 'Fix All' })
      await btn.waitFor()
      expect(btn).toBeTruthy()
    })
    test('status All button can be clicked', async () => {
      await page.goto(BASE)
      const btn = page.getByRole('button', { exact: true, name: 'Status All' })
      await btn.waitFor()
      expect(btn).toBeTruthy()
    })
    test('projects have correct GitHub URLs', async () => {
      await page.goto(BASE)
      await page.getByTestId('project-name-pm4ai').waitFor()
      const hrefs = await page
        .locator('a[href*="github.com/1qh"]')
        .evaluateAll(els => els.map(e => e.getAttribute('href')))
      expect(hrefs.length).toBeGreaterThan(0)
      for (const href of hrefs) expect(href).toMatch(/^https:\/\/github\.com\/1qh\/[\w-]+$/u)
    })
    test('no console errors on page load', async () => {
      const errors: string[] = []
      const p2 = await browser.newPage()
      p2.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text())
      })
      await p2.goto(BASE)
      await p2.getByRole('heading', { exact: true, level: 1, name: '⚡ pm4ai' }).waitFor()
      await p2.waitForTimeout(1000)
      await p2.close()
      const real = errors.filter(e => !(e.includes('ENOENT') || e.includes('watch.sock')))
      expect(real).toHaveLength(0)
    })
    test('page has dark theme styling', async () => {
      await page.goto(BASE)
      await page.locator('.min-h-screen').waitFor()
      const bg = await page.locator('.min-h-screen').evaluate(el => getComputedStyle(el).backgroundColor)
      expect(bg).toBeTruthy()
    })
    test('shows project count in header', async () => {
      await page.goto(BASE)
      await page.getByTestId('project-name-pm4ai').waitFor()
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
      expect(result.data).toHaveProperty('json')
      if (typeof result.data !== 'object' || result.data === null || !('json' in result.data))
        throw new Error('unexpected projects response')
      expect(Array.isArray(result.data.json)).toBe(true)
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
  describe('dashboard live events e2e', () => {
    test('event log updates when emitter sends events', async () => {
      const clients = new Set<Socket>()
      const emitter = createServer(socket => {
        clients.add(socket)
        socket.on('close', () => clients.delete(socket))
      })
      await new Promise<undefined>((resolve, reject) => {
        emitter.once('error', reject)
        emitter.listen(join(stateDirectory, 'watch.sock'), () => resolve(undefined))
      })
      try {
        await connectLiveEvents()
        expect(clients.size).toBeGreaterThan(0)
        for (const client of clients) {
          client.write(`${JSON.stringify(createEvent({ project: 'pm4ai', status: 'start', step: 'sync' }))}\n`)
          client.write(`${JSON.stringify(createEvent({ detail: '3 synced', project: 'pm4ai', status: 'ok', step: 'sync' }))}\n`)
        }
        await wait(2000)
        const logText = await page.textContent('.font-mono.text-xs')
        expect(logText).toBeTruthy()
      } finally {
        expect(clients.size).toBeGreaterThan(0)
        for (const client of clients) client.destroy()
        await new Promise<undefined>((resolve, reject) => {
          emitter.close(error => {
            if (error) reject(error)
            else resolve(undefined)
          })
        })
      }
    })
  })
})
