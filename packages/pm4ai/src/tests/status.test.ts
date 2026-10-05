import { $, file } from 'bun'
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { getUiSyncTime } from '../format.js'
import { timeAgo } from '../status.js'
setDefaultTimeout(30_000)
describe('timeAgo', () => {
  test('5 minutes ago', () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('5m ago')
  })
  test('2 hours ago', () => {
    const iso = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('2h ago')
  })
  test('3 days ago', () => {
    const iso = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('3d ago')
  })
  test('invalid date returns NaN gracefully', () => {
    const result = timeAgo('not-a-date')
    expect(result).toContain('NaN')
  })
  test('0 minutes ago', () => {
    const iso = new Date().toISOString()
    expect(timeAgo(iso)).toBe('0m ago')
  })
  test('59 minutes shows minutes', () => {
    const iso = new Date(Date.now() - 59 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('59m ago')
  })
  test('60 minutes shows 1h', () => {
    const iso = new Date(Date.now() - 60 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('1h ago')
  })
  test('23 hours shows hours', () => {
    const iso = new Date(Date.now() - 23 * 60 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('23h ago')
  })
})
describe('getUiSyncTime', () => {
  test('returns ? for paths without readonly/ui', async () => {
    const result = await getUiSyncTime([join(tmpdir(), 'nonexistent')])
    expect(result).toBe('?')
  })
  test('returns time for real pm4ai repo', async () => {
    const pm4aiPath = join(import.meta.dirname, '..', '..', '..', '..')
    const result = await getUiSyncTime([pm4aiPath])
    expect(result).not.toBe('?')
  })
  test('returns ? for empty paths array', async () => {
    const result = await getUiSyncTime([])
    expect(result).toBe('?')
  })
})
describe('status module exports', () => {
  test('status function is exported and callable', async () => {
    const { status } = await import('../status.js')
    expect(typeof status).toBe('function')
  })
  test('timeAgo is exported from status', async () => {
    const mod = await import('../status.js')
    expect(typeof mod.timeAgo).toBe('function')
  })
})
test('status --all shows every discovered project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pm4ai-status-'))
  try {
    const names = ['pm4ai', 'cnsync', 'status-fixture-app']
    const paths = names.map(name => join(root, name))
    const stateDir = join(root, 'state')
    const binDir = join(root, 'bin')
    await mkdir(binDir)
    await mkdir(join(stateDir, 'checks'), { recursive: true })
    for (const projectPath of paths) {
      await mkdir(projectPath)
      await writeFile(join(projectPath, 'turbo.json'), '{}')
      await writeFile(
        join(projectPath, 'package.json'),
        JSON.stringify({ devDependencies: { lintmax: 'workspace:*' }, private: true })
      )
      const safeName = projectPath.replaceAll('/', '--').replace(/^--/u, '')
      await writeFile(
        join(stateDir, 'checks', `${safeName}.lock`),
        JSON.stringify({ at: new Date().toISOString(), pid: process.pid })
      )
    }
    await mkdir(join(root, 'cnsync', 'readonly', 'ui'), { recursive: true })
    const gitShim = join(binDir, 'git')
    await writeFile(
      gitShim,
      '#!/bin/sh\n' +
        'if [ "$*" = "remote get-url origin" ]; then\n' +
        '  case "$PWD" in */cnsync) echo /fixture/1qh/cnsync; exit 0;; esac\nfi\nexit 1\n'
    )
    await chmod(gitShim, 0o755)
    const openShim = join(binDir, 'open')
    await writeFile(openShim, '#!/bin/sh\nexit 0\n')
    await chmod(openShim, 0o755)
    const cliPath = join(import.meta.dirname, '..', '..', 'dist', 'cli.mjs')
    const env = {
      ...process.env,
      HOME: root,
      PATH: `${binDir}:${process.env.PATH}`,
      PM4AI_HOME: root,
      PM4AI_STATE_DIR: stateDir
    }
    const result = await $`bun ${cliPath} status --all`.cwd(root).env(env).quiet().nothrow()
    expect(result.exitCode).toBe(0)
    const listedPaths = result
      .text()
      .split('\n')
      .filter(line => line.startsWith('/'))
      .toSorted((left, right) => left.localeCompare(right))
    expect(listedPaths).toEqual(paths.toSorted((left, right) => left.localeCompare(right)))
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}, 30_000)
const isCI = Boolean(process.env.CI)
describe.skipIf(isCI)('status() via CLI', () => {
  const cliPath = join(import.meta.dirname, '..', 'cli.ts')
  const repoRoot = join(import.meta.dirname, '..', '..', '..', '..')
  const copySkip = new Set(['.git', '.next', '.turbo', 'dist', 'node_modules'])
  let root = ''
  let pm4aiPath = ''
  let preloadPath = ''
  let env: Record<string, string | undefined> = {}
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'pm4ai-status-home-'))
    pm4aiPath = join(root, 'pm4ai')
    preloadPath = join(root, 'offline.ts')
    await cp(repoRoot, pm4aiPath, { filter: src => !copySkip.has(basename(src)), recursive: true })
    await mkdir(join(pm4aiPath, '.git'))
    const binDir = join(root, 'bin')
    const stateDir = join(root, 'state')
    await mkdir(binDir)
    await mkdir(join(stateDir, 'checks'), { recursive: true })
    const safeName = pm4aiPath.replaceAll('/', '--').replace(/^--/u, '')
    await writeFile(
      join(stateDir, 'checks', `${safeName}.lock`),
      JSON.stringify({ at: new Date().toISOString(), pid: process.pid })
    )
    for (const command of ['git', 'gh']) {
      const shimPath = join(binDir, command)
      await writeFile(shimPath, '#!/bin/sh\nexit 1\n')
      await chmod(shimPath, 0o755)
    }
    const openShim = join(binDir, 'open')
    await writeFile(openShim, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$HOME/swiftbar-refresh"\nexit 0\n')
    await chmod(openShim, 0o755)
    await writeFile(preloadPath, 'globalThis.fetch = async () => new Response(null, { status: 503 })\n')
    env = {
      ...process.env,
      HOME: root,
      PATH: `${binDir}:${process.env.PATH}`,
      PM4AI_HOME: root,
      PM4AI_NO_SWIFTBAR_REFRESH: '1',
      PM4AI_STATE_DIR: stateDir
    }
  })
  afterAll(async () => {
    if (root) await rm(root, { force: true, recursive: true })
  })
  test('status command runs on real project', async () => {
    const result = await $`bun --preload ${preloadPath} ${cliPath} status`.cwd(pm4aiPath).env(env).quiet().nothrow()
    expect(result.exitCode).toBe(0)
    expect(result.text()).toContain('pm4ai')
    expect(await file(join(root, 'swiftbar-refresh')).exists()).toBe(false)
  }, 30_000)
  test('status --swiftbar outputs SwiftBar format', async () => {
    const result = await $`bun --preload ${preloadPath} ${cliPath} status --swiftbar`
      .cwd(pm4aiPath)
      .env(env)
      .quiet()
      .nothrow()
    expect(result.exitCode).toBe(0)
    expect(result.text()).toContain('sfimage=')
    expect(result.text()).toContain('Refresh | refresh=true')
    expect(await file(join(root, 'swiftbar-refresh')).exists()).toBe(false)
  }, 120_000)
})
