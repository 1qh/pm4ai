/* eslint-disable @typescript-eslint/no-empty-function */
import { describe, expect, test } from 'bun:test'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isConnected, subscribe } from '../lib/socket'

const leadingSepRe = /^--/u
const pathExists = async (p: string): Promise<boolean> => {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}
describe('check result reading', () => {
  const checksDir = join(homedir(), '.pm4ai', 'checks')
  const toSafe = (p: string) => p.replaceAll('/', '--').replace(leadingSepRe, '')
  test('reads valid check result', async () => {
    await mkdir(checksDir, { recursive: true })
    const path = '/Users/o/z/pm4ai'
    const file = join(checksDir, `${toSafe(path)}.json`)
    if (await Bun.file(file).exists()) {
      const data = (await Bun.file(file).json()) as Record<string, unknown>
      expect(data.at).toBeDefined()
      expect(typeof data.pass).toBe('boolean')
      expect(typeof data.violations).toBe('number')
    }
  })
  test('check cache directory exists', async () => {
    expect(await pathExists(checksDir)).toBe(true)
  })
  test('all check files are valid JSON', async () => {
    const files = (await pathExists(checksDir)) ? (await readdir(checksDir)).filter(f => f.endsWith('.json')) : []
    const contents = await Promise.all(files.map(async f => Bun.file(join(checksDir, f)).text()))
    for (const content of contents)
      expect(() => {
        JSON.parse(content) as unknown
      }).not.toThrow()
  })
})
describe('project discovery from cache', () => {
  test('cache files map back to real paths', async () => {
    const checksDir = join(homedir(), '.pm4ai', 'checks')
    const checksDirExists = await pathExists(checksDir)
    if (!checksDirExists) return
    const files = (await readdir(checksDir)).filter(f => f.endsWith('.json'))
    const candidates = files.map(f => `/${f.replace('.json', '').replaceAll('--', '/')}`)
    const exists = await Promise.all(candidates.map(pathExists))
    const realProjects = candidates.filter((p, i) => exists[i] && !p.startsWith('/tmp/'))
    expect(realProjects.length).toBeGreaterThan(0)
    const realExists = await Promise.all(realProjects.map(pathExists))
    for (const e of realExists) expect(e).toBe(true)
  })
  test('known projects are in cache', async () => {
    const checksDir = join(homedir(), '.pm4ai', 'checks')
    const checksDirExists = await pathExists(checksDir)
    if (!checksDirExists) return
    const files = (await readdir(checksDir)).filter(f => f.endsWith('.json'))
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
  test('check file names decode to paths with correct format', async () => {
    const checksDir = join(homedir(), '.pm4ai', 'checks')
    const checksDirExists = await pathExists(checksDir)
    const files = checksDirExists ? (await readdir(checksDir)).filter(f => f.endsWith('.json')) : []
    for (const f of files) {
      const path = `/${f.replace('.json', '').replaceAll('--', '/')}`
      expect(path.startsWith('/')).toBe(true)
      expect(path.length).toBeGreaterThan(1)
    }
  })
  test('each cached project has at, pass, violations fields', async () => {
    const dir = join(homedir(), '.pm4ai', 'checks')
    const dirExists = await pathExists(dir)
    if (!dirExists) return
    const files = (await readdir(dir)).filter(f => f.endsWith('.json'))
    const datas = await Promise.all(
      files.map(async f => Bun.file(join(dir, f)).json() as Promise<Record<string, unknown>>)
    )
    for (const data of datas) {
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
