/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: intentional */
/* oxlint-disable no-empty-function, eslint-plugin-node(global-require), eslint-plugin-unicorn(prefer-module) */
/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
const leadingSepRe = /^--/u
describe('check result reading', () => {
  const checksDir = join(homedir(), '.pm4ai', 'checks')
  const toSafe = (p: string) => p.replaceAll('/', '--').replace(leadingSepRe, '')
  test('reads valid check result', () => {
    mkdirSync(checksDir, { recursive: true })
    const path = '/Users/o/z/pm4ai'
    const file = join(checksDir, `${toSafe(path)}.json`)
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      expect(data.at).toBeDefined()
      expect(typeof data.pass).toBe('boolean')
      expect(typeof data.violations).toBe('number')
    }
  })
  test('check cache directory exists', () => {
    expect(existsSync(checksDir)).toBe(true)
  })
  test('all check files are valid JSON', () => {
    const files = existsSync(checksDir) ? readdirSync(checksDir).filter(f => f.endsWith('.json')) : []
    for (const f of files) {
      const content = readFileSync(join(checksDir, f), 'utf8')
      expect(() => JSON.parse(content)).not.toThrow()
    }
  })
})
describe('project discovery from cache', () => {
  test('cache files map back to real paths', () => {
    const checksDir = join(homedir(), '.pm4ai', 'checks')
    if (!existsSync(checksDir)) return
    const files = readdirSync(checksDir).filter(f => f.endsWith('.json'))
    const realProjects = files
      .map(f => `/${f.replace('.json', '').replaceAll('--', '/')}`)
      .filter(p => existsSync(p) && !p.startsWith('/tmp/'))
    expect(realProjects.length).toBeGreaterThan(0)
    for (const p of realProjects) expect(existsSync(p)).toBe(true)
  })
  test('known projects are in cache', () => {
    const checksDir = join(homedir(), '.pm4ai', 'checks')
    if (!existsSync(checksDir)) return
    const files = readdirSync(checksDir).filter(f => f.endsWith('.json'))
    const names = files.map(f => f.replace('.json', '').split('--').pop())
    expect(names).toContain('pm4ai')
  })
})
describe('socket module', () => {
  test('subscribe returns unsubscribe function', async () => {
    const { subscribe } = await import('../lib/socket')
    const unsub = subscribe(() => {})
    expect(typeof unsub).toBe('function')
    unsub()
  })
  test('isConnected returns boolean', async () => {
    const { isConnected } = await import('../lib/socket')
    expect(typeof isConnected()).toBe('boolean')
  })
  test('isConnected is false when no emitter running', async () => {
    const { isConnected } = await import('../lib/socket')
    expect(isConnected()).toBe(false)
  })
})
