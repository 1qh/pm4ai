/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: intentional */
/* oxlint-disable no-empty-function, eslint-plugin-unicorn(prefer-module) */
/* eslint-disable @typescript-eslint/no-empty-function */
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isConnected, subscribe } from '../lib/socket'
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
      expect(() => {
        JSON.parse(content) as unknown
      }).not.toThrow()
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
const projectNameRe = /^[\w-]+$/u
describe('project name validation', () => {
  test('accepts simple names', () => {
    expect(projectNameRe.test('pm4ai')).toBe(true)
    expect(projectNameRe.test('lintmax')).toBe(true)
    expect(projectNameRe.test('ai-search-monitoring')).toBe(true)
    expect(projectNameRe.test('cnsync')).toBe(true)
  })
  test('rejects path traversal', () => {
    expect(projectNameRe.test('../etc/passwd')).toBe(false)
    expect(projectNameRe.test('/usr/bin')).toBe(false)
    expect(projectNameRe.test('foo/bar')).toBe(false)
  })
  test('rejects shell metacharacters', () => {
    expect(projectNameRe.test('$(whoami)')).toBe(false)
    expect(projectNameRe.test('foo;rm -rf')).toBe(false)
    expect(projectNameRe.test('a b')).toBe(false)
    expect(projectNameRe.test('foo`id`')).toBe(false)
  })
  test('rejects empty string', () => {
    expect(projectNameRe.test('')).toBe(false)
  })
  test('accepts underscores and numbers', () => {
    expect(projectNameRe.test('my_project_2')).toBe(true)
    expect(projectNameRe.test('v2_beta')).toBe(true)
  })
})
describe('getProjectsFromCache logic', () => {
  test('check file names decode to paths with correct format', () => {
    const files = existsSync(join(homedir(), '.pm4ai', 'checks'))
      ? readdirSync(join(homedir(), '.pm4ai', 'checks')).filter(f => f.endsWith('.json'))
      : []
    for (const f of files) {
      const path = `/${f.replace('.json', '').replaceAll('--', '/')}`
      expect(path.startsWith('/')).toBe(true)
      expect(path.length).toBeGreaterThan(1)
    }
  })
  test('each cached project has at, pass, violations fields', () => {
    const dir = join(homedir(), '.pm4ai', 'checks')
    if (!existsSync(dir)) return
    const files = readdirSync(dir).filter(f => f.endsWith('.json'))
    for (const f of files) {
      const data = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>
      expect(data).toHaveProperty('at')
      expect(data).toHaveProperty('pass')
      expect(data).toHaveProperty('violations')
    }
  })
})
describe('socket module', () => {
  test('subscribe returns unsubscribe function', () => {
    const unsub = subscribe(() => {})
    expect(typeof unsub).toBe('function')
    unsub()
  })
  test('isConnected returns boolean', () => {
    expect(typeof isConnected()).toBe('boolean')
  })
  test('isConnected is false when no emitter running', () => {
    expect(isConnected()).toBe(false)
  })
})
