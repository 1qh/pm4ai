import { $, file, write } from 'bun'
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fix, maintain } from '../fix.js'
import { stateDir, statePath } from '../state-dir.js'

setDefaultTimeout(30_000)
const makeTmp = async () => mkdtemp(join(tmpdir(), 'pm4ai-fix-'))
const leadingSepRe = /^--/u
const toFileName = (p: string) => p.replaceAll('/', '--').replace(leadingSepRe, '')
describe('maintain', () => {
  test('returns missing issue when up.sh does not exist', async () => {
    const tmp = await makeTmp()
    const issues = await maintain(tmp)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.type).toBe('up.sh')
    expect(issues[0]?.detail).toContain('missing')
    await rm(tmp, { recursive: true })
  })
  test('returns no issues when up.sh succeeds', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'up.sh'), '#!/bin/sh\nexit 0')
    const issues = await maintain(tmp)
    expect(issues.filter(i => i.type === 'up.sh')).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('returns failure issue when up.sh fails', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'up.sh'), '#!/bin/sh\necho "3 errors found" >&2\nexit 1')
    const issues = await maintain(tmp)
    expect(issues.some(i => i.type === 'up.sh' && i.detail.includes('failed'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('writes check result on success', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'up.sh'), '#!/bin/sh\nexit 0')
    await maintain(tmp)
    const safeName = toFileName(tmp)
    const checkFile = statePath('checks', `${safeName}.json`)
    expect(await file(checkFile).exists()).toBe(true)
    const result = (await file(checkFile).json()) as { pass: boolean }
    expect(result.pass).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('writes check result on failure', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'up.sh'), '#!/bin/sh\necho "5 violations" >&2\nexit 1')
    await maintain(tmp)
    const safeName = toFileName(tmp)
    const checkFile = statePath('checks', `${safeName}.json`)
    expect(await file(checkFile).exists()).toBe(true)
    const result = (await file(checkFile).json()) as { pass: boolean; violations: number }
    expect(result.pass).toBe(false)
    expect(result.violations).toBe(5)
    await rm(tmp, { recursive: true })
  })
  test('writes log entry', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'up.sh'), '#!/bin/sh\nexit 0')
    await maintain(tmp)
    const safeName = toFileName(tmp)
    const logFile = statePath('logs', `${safeName}.json`)
    expect(await file(logFile).exists()).toBe(true)
    await rm(tmp, { recursive: true })
  })
})
describe('lockfile', () => {
  const lockFile = statePath('fix.lock')
  test('atomic exclusive create prevents double acquisition', async () => {
    await rm(lockFile, { force: true })
    await mkdir(stateDir(), { recursive: true })
    const fd = await open(lockFile, 'wx')
    await fd.writeFile(JSON.stringify({ at: new Date().toISOString(), pid: process.pid }))
    await fd.close()
    expect(await file(lockFile).exists()).toBe(true)
    let secondAcquired = true
    try {
      const fd2 = await open(lockFile, 'wx')
      await fd2.close()
    } catch {
      secondAcquired = false
    }
    expect(secondAcquired).toBe(false)
    await rm(lockFile, { force: true })
  })
  test('stale lock with dead PID is removable', async () => {
    await rm(lockFile, { force: true })
    await mkdir(stateDir(), { recursive: true })
    await write(lockFile, JSON.stringify({ at: new Date(0).toISOString(), pid: 999_999 }))
    const lock = (await file(lockFile).json()) as { at: string; pid: number }
    const age = Date.now() - new Date(lock.at).getTime()
    expect(age).toBeGreaterThan(600_000)
    let alive = false
    try {
      process.kill(lock.pid, 0)
      alive = true
    } catch {
      /* Expected */
    }
    expect(alive).toBe(false)
    await rm(lockFile, { force: true })
    expect(await file(lockFile).exists()).toBe(false)
  })
  test('lock contains valid JSON with pid and timestamp', async () => {
    await rm(lockFile, { force: true })
    await mkdir(stateDir(), { recursive: true })
    const fd = await open(lockFile, 'wx')
    await fd.writeFile(JSON.stringify({ at: new Date().toISOString(), pid: process.pid }))
    await fd.close()
    const lock = (await file(lockFile).json()) as { at: string; pid: number }
    expect(lock.pid).toBe(process.pid)
    expect(new Date(lock.at).getTime()).not.toBeNaN()
    await rm(lockFile, { force: true })
  })
  test('stale lock from alive process under 10min blocks', async () => {
    await rm(lockFile, { force: true })
    await mkdir(stateDir(), { recursive: true })
    await write(lockFile, JSON.stringify({ at: new Date().toISOString(), pid: process.pid }))
    const lock = (await file(lockFile).json()) as { at: string; pid: number }
    const age = Date.now() - new Date(lock.at).getTime()
    expect(age).toBeLessThan(600_000)
    let alive = false
    try {
      process.kill(lock.pid, 0)
      alive = true
    } catch {
      /* Not found */
    }
    expect(alive).toBe(true)
    await rm(lockFile, { force: true })
  })
  test('corrupt lock file can be replaced', async () => {
    await rm(lockFile, { force: true })
    await mkdir(stateDir(), { recursive: true })
    await write(lockFile, 'not json')
    let parsed = false
    try {
      await file(lockFile).json()
      parsed = true
    } catch {
      /* Expected */
    }
    expect(parsed).toBe(false)
    await rm(lockFile, { force: true })
    const fd = await open(lockFile, 'wx')
    await fd.writeFile(JSON.stringify({ at: new Date().toISOString(), pid: process.pid }))
    await fd.close()
    expect(await file(lockFile).exists()).toBe(true)
    await rm(lockFile, { force: true })
  })
})
describe('maintain edge cases', () => {
  test('captures violation count from stderr', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'up.sh'), '#!/bin/sh\necho "12 errors found" >&2\nexit 1')
    await maintain(tmp)
    const safeName = toFileName(tmp)
    const checkFile = statePath('checks', `${safeName}.json`)
    const result = (await file(checkFile).json()) as { violations: number }
    expect(result.violations).toBe(12)
    await rm(tmp, { recursive: true })
  })
  test('captures violation/problem/issue keywords', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'up.sh'), '#!/bin/sh\necho "7 problems detected" >&2\nexit 1')
    await maintain(tmp)
    const safeName = toFileName(tmp)
    const checkFile = statePath('checks', `${safeName}.json`)
    const result = (await file(checkFile).json()) as { violations: number }
    expect(result.violations).toBe(7)
    await rm(tmp, { recursive: true })
  })
  test('defaults to 1 violation when no count found', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'up.sh'), '#!/bin/sh\necho "something broke" >&2\nexit 1')
    await maintain(tmp)
    const safeName = toFileName(tmp)
    const checkFile = statePath('checks', `${safeName}.json`)
    const result = (await file(checkFile).json()) as { violations: number }
    expect(result.violations).toBe(1)
    await rm(tmp, { recursive: true })
  })
  test('copies bun.lock snapshot on success', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'up.sh'), '#!/bin/sh\nexit 0')
    await write(join(tmp, 'bun.lock'), 'lockfile contents')
    await maintain(tmp)
    const snapshotDir = statePath('snapshots', tmp.split('/').pop() ?? '')
    expect(await file(join(snapshotDir, 'bun.lock')).exists()).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('log entry includes error on failure', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'up.sh'), '#!/bin/sh\necho "fatal error" >&2\nexit 1')
    await maintain(tmp)
    const safeName = toFileName(tmp)
    const logFile = statePath('logs', `${safeName}.json`)
    const entry = (await file(logFile).json()) as { error?: string; pass: boolean }
    expect(entry.pass).toBe(false)
    expect(entry.error).toContain('fatal error')
    await rm(tmp, { recursive: true })
  })
  test('log entry has no error on success', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'up.sh'), '#!/bin/sh\nexit 0')
    await maintain(tmp)
    const safeName = toFileName(tmp)
    const logFile = statePath('logs', `${safeName}.json`)
    const entry = (await file(logFile).json()) as { error?: string; pass: boolean }
    expect(entry.pass).toBe(true)
    expect(entry.error).toBeUndefined()
    await rm(tmp, { recursive: true })
  })
})
const isCI = Boolean(process.env.CI)
describe.skipIf(isCI)('fix() function', () => {
  const lockFile = statePath('fix.lock')
  test('blocks when lock held by alive process', async () => {
    await rm(lockFile, { force: true })
    await mkdir(stateDir(), { recursive: true })
    const fd = await open(lockFile, 'wx')
    await fd.writeFile(JSON.stringify({ at: new Date().toISOString(), pid: process.pid }))
    await fd.close()
    await fix()
    expect(await file(lockFile).exists()).toBe(true)
    await rm(lockFile, { force: true })
  })
  test('recovers stale lock from dead process', async () => {
    await rm(lockFile, { force: true })
    await mkdir(stateDir(), { recursive: true })
    await write(lockFile, JSON.stringify({ at: new Date(0).toISOString(), pid: 999_999 }))
    const saved = process.cwd()
    const pm4aiPath = join(import.meta.dirname, '..', '..', '..', '..')
    process.chdir(pm4aiPath)
    await fix()
    process.chdir(saved)
    expect(await file(lockFile).exists()).toBe(false)
  }, 30_000)
  test('cleans up lock after execution', async () => {
    await rm(lockFile, { force: true })
    const saved = process.cwd()
    const pm4aiPath = join(import.meta.dirname, '..', '..', '..', '..')
    process.chdir(pm4aiPath)
    await fix()
    process.chdir(saved)
    expect(await file(lockFile).exists()).toBe(false)
  }, 30_000)
  test('blocks when git is dirty', async () => {
    await rm(lockFile, { force: true })
    const tmp = await makeTmp()
    await $`git init`.cwd(tmp).quiet().nothrow()
    await $`git -c user.name=test -c user.email=test@test commit --allow-empty -m init`.cwd(tmp).quiet().nothrow()
    await write(join(tmp, 'dirty.txt'), 'dirty')
    await write(
      join(tmp, 'package.json'),
      JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'test', private: true })
    )
    const saved = process.cwd()
    process.chdir(tmp)
    await fix()
    process.chdir(saved)
    expect(await file(lockFile).exists()).toBe(false)
    await rm(tmp, { recursive: true })
  }, 30_000)
})
describe('fix() via CLI', () => {
  test('fix --help or unknown falls through to guide', async () => {
    const cliPath = join(import.meta.dirname, '..', '..', 'dist', 'cli.mjs')
    const out = (await $`bun ${cliPath} fixxx`.quiet().nothrow().text()).trim()
    expect(out).toContain('commands:')
  })
  test('refusing a dirty repo exits non-zero', async () => {
    const cliPath = join(import.meta.dirname, '..', '..', 'dist', 'cli.mjs')
    const repo = await makeTmp()
    await $`git init -q .`.cwd(repo).quiet().nothrow()
    await write(
      join(repo, 'package.json'),
      JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'dirty-probe' })
    )
    await $`git add -A`.cwd(repo).quiet().nothrow()
    await $`git -c user.email=t@t -c user.name=t commit -qm init`.cwd(repo).quiet().nothrow()
    await write(
      join(repo, 'package.json'),
      JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'dirty-probe', x: 1 })
    )
    const fakeHome = await makeTmp()
    for (const name of ['pm4ai', 'cnsync']) {
      const src = join(fakeHome, '.pm4ai', 'repos', name)
      await mkdir(src, { recursive: true })
      await $`git init -q .`.cwd(src).quiet().nothrow()
    }
    const result = await $`bun ${cliPath} fix`
      .cwd(repo)
      .env({ ...process.env, PM4AI_HOME: fakeHome })
      .quiet()
      .nothrow()
    expect(result.exitCode).not.toBe(0)
    await rm(repo, { recursive: true })
    await rm(fakeHome, { recursive: true })
  }, 60_000)
})
