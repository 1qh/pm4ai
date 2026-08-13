import { write } from 'bun'
import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectWorkspacePackages,
  getBunVersion,
  getGhRepo,
  isInsideProject,
  projectName,
  readJson,
  readPkg
} from '../utils.js'

const makeTmp = async () => mkdtemp(join(tmpdir(), 'pm4ai-utils-'))
describe('projectName', () => {
  test('extracts last segment', () => {
    expect(projectName('/Users/o/z/pm4ai')).toBe('pm4ai')
  })
  test('empty string returns empty', () => {
    expect(projectName('')).toBe('')
  })
})
describe('readJson', () => {
  test('nonexistent file returns undefined', async () => {
    const missing = join(tmpdir(), 'does-not-exist-xyz.json')
    expect(await readJson(missing)).toBeUndefined()
  })
  test('valid JSON file returns parsed object', async () => {
    const p = join(tmpdir(), `test-${Date.now()}.json`)
    await write(p, '{"a":1}')
    expect(await readJson(p)).toEqual({ a: 1 })
  })
  test('malformed JSON returns undefined', async () => {
    const p = join(tmpdir(), `test-bad-${Date.now()}.json`)
    await write(p, '{broken')
    expect(await readJson(p)).toBeUndefined()
  })
})
describe('readPkg', () => {
  test('valid package.json returns object', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    const pkg = await readPkg(join(tmp, 'package.json'))
    expect(pkg?.name).toBe('test')
    await rm(tmp, { recursive: true })
  })
  test('non-object returns undefined', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'package.json'), '"just a string"')
    const pkg = await readPkg(join(tmp, 'package.json'))
    expect(pkg).toBeUndefined()
    await rm(tmp, { recursive: true })
  })
  test('missing file returns undefined', async () => {
    const pkg = await readPkg(join(tmpdir(), 'nonexistent', 'package.json'))
    expect(pkg).toBeUndefined()
  })
})
describe('getBunVersion', () => {
  test('returns a version string', async () => {
    const version = await getBunVersion()
    expect(version.split('.').length).toBeGreaterThanOrEqual(3)
  })
})
describe('getGhRepo', () => {
  test('returns repo for real pm4ai directory', async () => {
    const pm4aiPath = join(import.meta.dirname, '..', '..', '..', '..')
    const repo = await getGhRepo(pm4aiPath)
    expect(repo).toBe('1qh/pm4ai')
  })
  test('returns undefined for non-git directory', async () => {
    const tmp = await makeTmp()
    const repo = await getGhRepo(tmp)
    expect(repo).toBeUndefined()
    await rm(tmp, { recursive: true })
  })
})
describe('collectWorkspacePackages', () => {
  test('collects root and sub-packages', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'packages', 'lib'), { recursive: true })
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }))
    await write(join(tmp, 'packages', 'lib', 'package.json'), JSON.stringify({ name: '@a/lib' }))
    const entries = await collectWorkspacePackages(tmp)
    expect(entries).toHaveLength(2)
    expect(entries[0]?.pkg.name).toBe('root')
    expect(entries[1]?.pkg.name).toBe('@a/lib')
    await rm(tmp, { recursive: true })
  })
  test('returns only root when no workspaces', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'solo', private: true }))
    const entries = await collectWorkspacePackages(tmp)
    expect(entries).toHaveLength(1)
    await rm(tmp, { recursive: true })
  })
  test('returns empty for missing package.json', async () => {
    const tmp = await makeTmp()
    const entries = await collectWorkspacePackages(tmp)
    expect(entries).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('handles workspace dir that does not exist', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true, workspaces: ['nonexistent/*'] }))
    const entries = await collectWorkspacePackages(tmp)
    expect(entries).toHaveLength(1)
    await rm(tmp, { recursive: true })
  })
  test('handles nested glob pattern packages/**', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'packages', 'group', 'lib'), { recursive: true })
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'root', private: true, workspaces: ['packages/**'] }))
    await write(join(tmp, 'packages', 'group', 'lib', 'package.json'), JSON.stringify({ name: '@a/deep' }))
    const entries = await collectWorkspacePackages(tmp)
    expect(entries.some(e => e.pkg.name === '@a/deep')).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('handles multiple workspace patterns', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'packages', 'lib'), { recursive: true })
    await mkdir(join(tmp, 'apps', 'web'), { recursive: true })
    await write(
      join(tmp, 'package.json'),
      JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*', 'apps/*'] })
    )
    await write(join(tmp, 'packages', 'lib', 'package.json'), JSON.stringify({ name: '@a/lib' }))
    await write(join(tmp, 'apps', 'web', 'package.json'), JSON.stringify({ name: '@a/web', private: true }))
    const entries = await collectWorkspacePackages(tmp)
    expect(entries).toHaveLength(3)
    await rm(tmp, { recursive: true })
  })
  test('handles negated workspace patterns', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'packages', 'lib'), { recursive: true })
    await mkdir(join(tmp, 'packages', 'internal'), { recursive: true })
    await write(
      join(tmp, 'package.json'),
      JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*', '!packages/internal'] })
    )
    await write(join(tmp, 'packages', 'lib', 'package.json'), JSON.stringify({ name: '@a/lib' }))
    await write(join(tmp, 'packages', 'internal', 'package.json'), JSON.stringify({ name: '@a/internal' }))
    const entries = await collectWorkspacePackages(tmp)
    expect(entries).toHaveLength(2)
    expect(entries.some(e => e.pkg.name === '@a/lib')).toBe(true)
    expect(entries.some(e => e.pkg.name === '@a/internal')).toBe(false)
    await rm(tmp, { recursive: true })
  })
  test('skips dirs without package.json', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'packages', 'empty'), { recursive: true })
    await mkdir(join(tmp, 'packages', 'lib'), { recursive: true })
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }))
    await write(join(tmp, 'packages', 'lib', 'package.json'), JSON.stringify({ name: '@a/lib' }))
    const entries = await collectWorkspacePackages(tmp)
    expect(entries).toHaveLength(2)
    await rm(tmp, { recursive: true })
  })
})
describe('isInsideProject', () => {
  test('returns path when inside a git repo with lintmax', async () => {
    const pm4aiPath = join(import.meta.dirname, '..', '..', '..', '..')
    const saved = process.cwd()
    process.chdir(pm4aiPath)
    const result = await isInsideProject()
    process.chdir(saved)
    expect(result).toBe(pm4aiPath)
  })
  test('returns undefined for non-project directory', async () => {
    const tmp = await makeTmp()
    const saved = process.cwd()
    process.chdir(tmp)
    const result = await isInsideProject()
    process.chdir(saved)
    expect(result).toBeUndefined()
    await rm(tmp, { recursive: true })
  })
})
describe('mergeExtendable', () => {
  test('keeps a project entry when the canonical prefix itself changes', async () => {
    const { mergeExtendable } = await import('../utils.js')
    const before = 'node_modules\ndist\n'
    const after = 'node_modules\ndist\nreadonly/ui/**/*.d.ts\n'
    const consumer = `${before}project.config.d.ts\n`
    const merged = mergeExtendable(after, consumer)
    expect(merged).toContain('readonly/ui/**/*.d.ts')
    expect(merged).toContain('project.config.d.ts')
  })
  test('adds nothing when the project carries no entry of its own', async () => {
    const { mergeExtendable } = await import('../utils.js')
    const canonical = 'node_modules\ndist\n'
    expect(mergeExtendable(canonical, canonical)).toBe(canonical)
  })
  test('preserves a nested extension block whose inner key collides with a canonical key', async () => {
    const { mergeExtendable } = await import('../utils.js')
    const canonicalTail =
      'jobs:\n  ci:\n    steps:\n      - name: prune\n        env:\n          GH_TOKEN: x\n        run: sh prune.sh\n'
    const canonicalNew = `on:\n  push:\n    paths-ignore:\n      - CLAUDE.md\n${canonicalTail}`
    const consumer = `${canonicalTail}      - name: hermetic\n        env:\n          DB: secret\n        run: sh test.sh\n`
    const merged = mergeExtendable(canonicalNew, consumer)
    expect(merged).toContain('- CLAUDE.md')
    expect(merged).toContain('      - name: hermetic')
    expect(merged).toContain('        env:\n          DB: secret')
    expect(merged).toContain('        run: sh test.sh')
  })
})
