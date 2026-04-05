import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
const makeTmp = () => mkdtempSync(join(tmpdir(), 'pm4ai-utils-'))
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
    expect(await readJson('/tmp/does-not-exist-xyz.json')).toBeUndefined()
  })
  test('valid JSON file returns parsed object', async () => {
    const p = join(tmpdir(), `test-${Date.now()}.json`)
    writeFileSync(p, '{"a":1}')
    expect(await readJson(p)).toEqual({ a: 1 })
  })
  test('malformed JSON returns undefined', async () => {
    const p = join(tmpdir(), `test-bad-${Date.now()}.json`)
    writeFileSync(p, '{broken')
    expect(await readJson(p)).toBeUndefined()
  })
})
describe('readPkg', () => {
  test('valid package.json returns object', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    const pkg = await readPkg(join(tmp, 'package.json'))
    expect(pkg?.name).toBe('test')
    rmSync(tmp, { recursive: true })
  })
  test('non-object returns undefined', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'package.json'), '"just a string"')
    const pkg = await readPkg(join(tmp, 'package.json'))
    expect(pkg).toBeUndefined()
    rmSync(tmp, { recursive: true })
  })
  test('missing file returns undefined', async () => {
    const pkg = await readPkg('/tmp/nonexistent/package.json')
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
    const tmp = makeTmp()
    const repo = await getGhRepo(tmp)
    expect(repo).toBeUndefined()
    rmSync(tmp, { recursive: true })
  })
})
describe('collectWorkspacePackages', () => {
  test('collects root and sub-packages', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'packages', 'lib'), { recursive: true })
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }))
    writeFileSync(join(tmp, 'packages', 'lib', 'package.json'), JSON.stringify({ name: '@a/lib' }))
    const entries = await collectWorkspacePackages(tmp)
    expect(entries).toHaveLength(2)
    expect(entries[0]?.pkg.name).toBe('root')
    expect(entries[1]?.pkg.name).toBe('@a/lib')
    rmSync(tmp, { recursive: true })
  })
  test('returns only root when no workspaces', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'solo', private: true }))
    const entries = await collectWorkspacePackages(tmp)
    expect(entries).toHaveLength(1)
    rmSync(tmp, { recursive: true })
  })
  test('returns empty for missing package.json', async () => {
    const tmp = makeTmp()
    const entries = await collectWorkspacePackages(tmp)
    expect(entries).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
  test('handles workspace dir that does not exist', async () => {
    const tmp = makeTmp()
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ name: 'test', private: true, workspaces: ['nonexistent/*'] })
    )
    const entries = await collectWorkspacePackages(tmp)
    expect(entries).toHaveLength(1)
    rmSync(tmp, { recursive: true })
  })
  test('handles nested glob pattern packages/**', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'packages', 'group', 'lib'), { recursive: true })
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'root', private: true, workspaces: ['packages/**'] }))
    writeFileSync(join(tmp, 'packages', 'group', 'lib', 'package.json'), JSON.stringify({ name: '@a/deep' }))
    const entries = await collectWorkspacePackages(tmp)
    expect(entries.some(e => e.pkg.name === '@a/deep')).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('handles multiple workspace patterns', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'packages', 'lib'), { recursive: true })
    mkdirSync(join(tmp, 'apps', 'web'), { recursive: true })
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*', 'apps/*'] })
    )
    writeFileSync(join(tmp, 'packages', 'lib', 'package.json'), JSON.stringify({ name: '@a/lib' }))
    writeFileSync(join(tmp, 'apps', 'web', 'package.json'), JSON.stringify({ name: '@a/web', private: true }))
    const entries = await collectWorkspacePackages(tmp)
    expect(entries).toHaveLength(3)
    rmSync(tmp, { recursive: true })
  })
  test('handles negated workspace patterns', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'packages', 'lib'), { recursive: true })
    mkdirSync(join(tmp, 'packages', 'internal'), { recursive: true })
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*', '!packages/internal'] })
    )
    writeFileSync(join(tmp, 'packages', 'lib', 'package.json'), JSON.stringify({ name: '@a/lib' }))
    writeFileSync(join(tmp, 'packages', 'internal', 'package.json'), JSON.stringify({ name: '@a/internal' }))
    const entries = await collectWorkspacePackages(tmp)
    expect(entries).toHaveLength(2)
    expect(entries.some(e => e.pkg.name === '@a/lib')).toBe(true)
    expect(entries.some(e => e.pkg.name === '@a/internal')).toBe(false)
    rmSync(tmp, { recursive: true })
  })
  test('skips dirs without package.json', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'packages', 'empty'), { recursive: true })
    mkdirSync(join(tmp, 'packages', 'lib'), { recursive: true })
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }))
    writeFileSync(join(tmp, 'packages', 'lib', 'package.json'), JSON.stringify({ name: '@a/lib' }))
    const entries = await collectWorkspacePackages(tmp)
    expect(entries).toHaveLength(2)
    rmSync(tmp, { recursive: true })
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
    const tmp = makeTmp()
    const saved = process.cwd()
    process.chdir(tmp)
    const result = await isInsideProject()
    process.chdir(saved)
    expect(result).toBeUndefined()
    rmSync(tmp, { recursive: true })
  })
})
