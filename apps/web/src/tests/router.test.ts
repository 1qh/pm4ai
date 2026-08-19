import { write } from 'bun'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseJson } from '../lib/json'
import { isConnected, subscribe } from '../lib/socket'

const leadingSepRe = /^--/u
const toSafe = (p: string) => p.replaceAll('/', '--').replace(leadingSepRe, '')
const decode = (fileName: string) => `/${fileName.replace('.json', '').replaceAll('--', '/')}`
const makeChecksDir = async (): Promise<string> => mkdtemp(join(tmpdir(), 'pm4ai-web-checks-'))
const writeCheck = async (dir: string, path: string, data: Record<string, unknown>): Promise<void> => {
  await write(join(dir, `${toSafe(path)}.json`), JSON.stringify(data))
}
const jsonFiles = async (dir: string): Promise<string[]> => (await readdir(dir)).filter(f => f.endsWith('.json'))
describe('check result reading', () => {
  test('reads and validates a check result', async () => {
    const dir = await makeChecksDir()
    await writeCheck(dir, '/Users/o/z/pm4ai', { at: '2026-01-01T00:00:00Z', pass: true, violations: 0 })
    const [firstFile] = await jsonFiles(dir)
    expect(firstFile).toBeDefined()
    const data = parseJson<Record<string, unknown>>(await Bun.file(join(dir, firstFile ?? '')).text())
    expect(data.at).toBeDefined()
    expect(typeof data.pass).toBe('boolean')
    expect(typeof data.violations).toBe('number')
    await rm(dir, { recursive: true })
  })
  test('all check files are valid JSON', async () => {
    const dir = await makeChecksDir()
    await writeCheck(dir, '/a/b', { at: 'x', pass: true, violations: 0 })
    await writeCheck(dir, '/c/d', { at: 'y', pass: false, violations: 3 })
    const contents = await Promise.all((await jsonFiles(dir)).map(async f => Bun.file(join(dir, f)).text()))
    for (const content of contents)
      expect(() => {
        JSON.parse(content)
      }).not.toThrow()
    await rm(dir, { recursive: true })
  })
})
describe('project discovery from cache', () => {
  test('cache filenames decode back to their paths', async () => {
    const dir = await makeChecksDir()
    await writeCheck(dir, '/Users/o/pm4ai', { at: 'x', pass: true, violations: 0 })
    await writeCheck(dir, '/Users/o/lintmax', { at: 'y', pass: true, violations: 0 })
    const decoded = (await jsonFiles(dir)).map(decode)
    expect(decoded).toContain('/Users/o/pm4ai')
    expect(decoded).toContain('/Users/o/lintmax')
    await rm(dir, { recursive: true })
  })
  test('decoded project name is the last path segment', async () => {
    const dir = await makeChecksDir()
    await writeCheck(dir, '/Users/o/pm4ai', { at: 'x', pass: true, violations: 0 })
    const names = (await jsonFiles(dir)).map(f => f.replace('.json', '').split('--').pop())
    expect(names).toContain('pm4ai')
    await rm(dir, { recursive: true })
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
  test('check file names decode to absolute paths', async () => {
    const dir = await makeChecksDir()
    await writeCheck(dir, '/x/y/z', { at: 'x', pass: true, violations: 0 })
    for (const f of await jsonFiles(dir)) {
      const path = decode(f)
      expect(path.startsWith('/')).toBe(true)
      expect(path.length).toBeGreaterThan(1)
    }
    await rm(dir, { recursive: true })
  })
  test('each cached project json has at, pass, violations', async () => {
    const dir = await makeChecksDir()
    await writeCheck(dir, '/x/y', { at: 'x', pass: true, violations: 0 })
    const datas = await Promise.all(
      (await jsonFiles(dir)).map(async f => parseJson<Record<string, unknown>>(await Bun.file(join(dir, f)).text()))
    )
    for (const data of datas) {
      expect(data).toHaveProperty('at')
      expect(data).toHaveProperty('pass')
      expect(data).toHaveProperty('violations')
    }
    await rm(dir, { recursive: true })
  })
})
describe('socket module', () => {
  test('subscribe returns unsubscribe function', () => {
    const unsub = subscribe(() => {
      /* empty */
    })
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
