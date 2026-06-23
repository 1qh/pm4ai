import { describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fix, maintain } from '../fix.js'
// oxlint-disable-next-line node/no-sync
const makeTmp = () => mkdtempSync(join(tmpdir(), 'pm4ai-fix-'))
const leadingSepRe = /^--/u
const toFileName = (p: string) => p.replaceAll('/', '--').replace(leadingSepRe, '')
describe('maintain', () => {
  test('returns missing issue when up.sh does not exist', async () => {
    const tmp = makeTmp()
    const issues = await maintain(tmp)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.type).toBe('up.sh')
    expect(issues[0]?.detail).toContain('missing')
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('returns no issues when up.sh succeeds', async () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'up.sh'), '#!/bin/sh\nexit 0')
    const issues = await maintain(tmp)
    expect(issues.filter(i => i.type === 'up.sh')).toHaveLength(0)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('returns failure issue when up.sh fails', async () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'up.sh'), '#!/bin/sh\necho "3 errors found" >&2\nexit 1')
    const issues = await maintain(tmp)
    expect(issues.some(i => i.type === 'up.sh' && i.detail.includes('failed'))).toBe(true)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('writes check result on success', async () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'up.sh'), '#!/bin/sh\nexit 0')
    await maintain(tmp)
    const safeName = toFileName(tmp)
    const checkFile = join(homedir(), '.pm4ai', 'checks', `${safeName}.json`)
    // oxlint-disable-next-line node/no-sync
    expect(existsSync(checkFile)).toBe(true)
    // oxlint-disable-next-line node/no-sync
    const result = JSON.parse(readFileSync(checkFile, 'utf8')) as { pass: boolean }
    expect(result.pass).toBe(true)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('writes check result on failure', async () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'up.sh'), '#!/bin/sh\necho "5 violations" >&2\nexit 1')
    await maintain(tmp)
    const safeName = toFileName(tmp)
    const checkFile = join(homedir(), '.pm4ai', 'checks', `${safeName}.json`)
    // oxlint-disable-next-line node/no-sync
    expect(existsSync(checkFile)).toBe(true)
    // oxlint-disable-next-line node/no-sync
    const result = JSON.parse(readFileSync(checkFile, 'utf8')) as { pass: boolean; violations: number }
    expect(result.pass).toBe(false)
    expect(result.violations).toBe(5)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('writes log entry', async () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'up.sh'), '#!/bin/sh\nexit 0')
    await maintain(tmp)
    const safeName = toFileName(tmp)
    const logFile = join(homedir(), '.pm4ai', 'logs', `${safeName}.json`)
    // oxlint-disable-next-line node/no-sync
    expect(existsSync(logFile)).toBe(true)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
})
describe('lockfile', () => {
  const lockFile = join(homedir(), '.pm4ai', 'fix.lock')
  test('atomic exclusive create prevents double acquisition', () => {
    // oxlint-disable-next-line node/no-sync
    rmSync(lockFile, { force: true })
    // oxlint-disable-next-line node/no-sync
    mkdirSync(join(homedir(), '.pm4ai'), { recursive: true })
    // oxlint-disable-next-line node/no-sync
    const fd = openSync(lockFile, 'wx')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(fd, JSON.stringify({ at: new Date().toISOString(), pid: process.pid }))
    // oxlint-disable-next-line node/no-sync
    closeSync(fd)
    // oxlint-disable-next-line node/no-sync
    expect(existsSync(lockFile)).toBe(true)
    let secondAcquired = true
    try {
      // oxlint-disable-next-line node/no-sync
      const fd2 = openSync(lockFile, 'wx')
      // oxlint-disable-next-line node/no-sync
      closeSync(fd2)
    } catch {
      secondAcquired = false
    }
    expect(secondAcquired).toBe(false)
    // oxlint-disable-next-line node/no-sync
    rmSync(lockFile, { force: true })
  })
  test('stale lock with dead PID is removable', () => {
    // oxlint-disable-next-line node/no-sync
    rmSync(lockFile, { force: true })
    // oxlint-disable-next-line node/no-sync
    mkdirSync(join(homedir(), '.pm4ai'), { recursive: true })
    // oxlint-disable-next-line node/no-sync
    writeFileSync(lockFile, JSON.stringify({ at: new Date(0).toISOString(), pid: 999_999 }))
    // oxlint-disable-next-line node/no-sync
    const lock = JSON.parse(readFileSync(lockFile, 'utf8')) as { at: string; pid: number }
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
    // oxlint-disable-next-line node/no-sync
    rmSync(lockFile, { force: true })
    // oxlint-disable-next-line node/no-sync
    expect(existsSync(lockFile)).toBe(false)
  })
  test('lock contains valid JSON with pid and timestamp', () => {
    // oxlint-disable-next-line node/no-sync
    rmSync(lockFile, { force: true })
    // oxlint-disable-next-line node/no-sync
    mkdirSync(join(homedir(), '.pm4ai'), { recursive: true })
    // oxlint-disable-next-line node/no-sync
    const fd = openSync(lockFile, 'wx')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(fd, JSON.stringify({ at: new Date().toISOString(), pid: process.pid }))
    // oxlint-disable-next-line node/no-sync
    closeSync(fd)
    // oxlint-disable-next-line node/no-sync
    const lock = JSON.parse(readFileSync(lockFile, 'utf8')) as { at: string; pid: number }
    expect(lock.pid).toBe(process.pid)
    expect(new Date(lock.at).getTime()).not.toBeNaN()
    // oxlint-disable-next-line node/no-sync
    rmSync(lockFile, { force: true })
  })
  test('stale lock from alive process under 10min blocks', () => {
    // oxlint-disable-next-line node/no-sync
    rmSync(lockFile, { force: true })
    // oxlint-disable-next-line node/no-sync
    mkdirSync(join(homedir(), '.pm4ai'), { recursive: true })
    // oxlint-disable-next-line node/no-sync
    writeFileSync(lockFile, JSON.stringify({ at: new Date().toISOString(), pid: process.pid }))
    // oxlint-disable-next-line node/no-sync
    const lock = JSON.parse(readFileSync(lockFile, 'utf8')) as { at: string; pid: number }
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
    // oxlint-disable-next-line node/no-sync
    rmSync(lockFile, { force: true })
  })
  test('corrupt lock file can be replaced', () => {
    // oxlint-disable-next-line node/no-sync
    rmSync(lockFile, { force: true })
    // oxlint-disable-next-line node/no-sync
    mkdirSync(join(homedir(), '.pm4ai'), { recursive: true })
    // oxlint-disable-next-line node/no-sync
    writeFileSync(lockFile, 'not json')
    let parsed = false
    try {
      // oxlint-disable-next-line node/no-sync
      JSON.parse(readFileSync(lockFile, 'utf8'))
      parsed = true
    } catch {
      /* Expected */
    }
    expect(parsed).toBe(false)
    // oxlint-disable-next-line node/no-sync
    rmSync(lockFile, { force: true })
    // oxlint-disable-next-line node/no-sync
    const fd = openSync(lockFile, 'wx')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(fd, JSON.stringify({ at: new Date().toISOString(), pid: process.pid }))
    // oxlint-disable-next-line node/no-sync
    closeSync(fd)
    // oxlint-disable-next-line node/no-sync
    expect(existsSync(lockFile)).toBe(true)
    // oxlint-disable-next-line node/no-sync
    rmSync(lockFile, { force: true })
  })
})
describe('maintain edge cases', () => {
  test('captures violation count from stderr', async () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'up.sh'), '#!/bin/sh\necho "12 errors found" >&2\nexit 1')
    await maintain(tmp)
    const safeName = toFileName(tmp)
    const checkFile = join(homedir(), '.pm4ai', 'checks', `${safeName}.json`)
    // oxlint-disable-next-line node/no-sync
    const result = JSON.parse(readFileSync(checkFile, 'utf8')) as { violations: number }
    expect(result.violations).toBe(12)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('captures violation/problem/issue keywords', async () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'up.sh'), '#!/bin/sh\necho "7 problems detected" >&2\nexit 1')
    await maintain(tmp)
    const safeName = toFileName(tmp)
    const checkFile = join(homedir(), '.pm4ai', 'checks', `${safeName}.json`)
    // oxlint-disable-next-line node/no-sync
    const result = JSON.parse(readFileSync(checkFile, 'utf8')) as { violations: number }
    expect(result.violations).toBe(7)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('defaults to 1 violation when no count found', async () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'up.sh'), '#!/bin/sh\necho "something broke" >&2\nexit 1')
    await maintain(tmp)
    const safeName = toFileName(tmp)
    const checkFile = join(homedir(), '.pm4ai', 'checks', `${safeName}.json`)
    // oxlint-disable-next-line node/no-sync
    const result = JSON.parse(readFileSync(checkFile, 'utf8')) as { violations: number }
    expect(result.violations).toBe(1)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('copies bun.lock snapshot on success', async () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'up.sh'), '#!/bin/sh\nexit 0')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'bun.lock'), 'lockfile contents')
    await maintain(tmp)
    const snapshotDir = join(homedir(), '.pm4ai', 'snapshots', tmp.split('/').pop() ?? '')
    // oxlint-disable-next-line node/no-sync
    expect(existsSync(join(snapshotDir, 'bun.lock'))).toBe(true)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('log entry includes error on failure', async () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'up.sh'), '#!/bin/sh\necho "fatal error" >&2\nexit 1')
    await maintain(tmp)
    const safeName = toFileName(tmp)
    const logFile = join(homedir(), '.pm4ai', 'logs', `${safeName}.json`)
    // oxlint-disable-next-line node/no-sync
    const entry = JSON.parse(readFileSync(logFile, 'utf8')) as { error?: string; pass: boolean }
    expect(entry.pass).toBe(false)
    expect(entry.error).toContain('fatal error')
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('log entry has no error on success', async () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'up.sh'), '#!/bin/sh\nexit 0')
    await maintain(tmp)
    const safeName = toFileName(tmp)
    const logFile = join(homedir(), '.pm4ai', 'logs', `${safeName}.json`)
    // oxlint-disable-next-line node/no-sync
    const entry = JSON.parse(readFileSync(logFile, 'utf8')) as { error?: string; pass: boolean }
    expect(entry.pass).toBe(true)
    expect(entry.error).toBeUndefined()
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
})
const isCI = Boolean(process.env.CI)
describe.skipIf(isCI)('fix() function', () => {
  const lockFile = join(homedir(), '.pm4ai', 'fix.lock')
  test('blocks when lock held by alive process', async () => {
    // oxlint-disable-next-line node/no-sync
    rmSync(lockFile, { force: true })
    // oxlint-disable-next-line node/no-sync
    mkdirSync(join(homedir(), '.pm4ai'), { recursive: true })
    // oxlint-disable-next-line node/no-sync
    const fd = openSync(lockFile, 'wx')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(fd, JSON.stringify({ at: new Date().toISOString(), pid: process.pid }))
    // oxlint-disable-next-line node/no-sync
    closeSync(fd)
    await fix()
    // oxlint-disable-next-line node/no-sync
    expect(existsSync(lockFile)).toBe(true)
    // oxlint-disable-next-line node/no-sync
    rmSync(lockFile, { force: true })
  })
  test('recovers stale lock from dead process', async () => {
    // oxlint-disable-next-line node/no-sync
    rmSync(lockFile, { force: true })
    // oxlint-disable-next-line node/no-sync
    mkdirSync(join(homedir(), '.pm4ai'), { recursive: true })
    // oxlint-disable-next-line node/no-sync
    writeFileSync(lockFile, JSON.stringify({ at: new Date(0).toISOString(), pid: 999_999 }))
    const saved = process.cwd()
    const pm4aiPath = join(import.meta.dirname, '..', '..', '..', '..')
    process.chdir(pm4aiPath)
    await fix()
    process.chdir(saved)
    // oxlint-disable-next-line node/no-sync
    expect(existsSync(lockFile)).toBe(false)
  }, 30_000)
  test('cleans up lock after execution', async () => {
    // oxlint-disable-next-line node/no-sync
    rmSync(lockFile, { force: true })
    const saved = process.cwd()
    const pm4aiPath = join(import.meta.dirname, '..', '..', '..', '..')
    process.chdir(pm4aiPath)
    await fix()
    process.chdir(saved)
    // oxlint-disable-next-line node/no-sync
    expect(existsSync(lockFile)).toBe(false)
  }, 30_000)
  test('blocks when git is dirty', async () => {
    // oxlint-disable-next-line node/no-sync
    rmSync(lockFile, { force: true })
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    execSync('git init', { cwd: tmp, stdio: 'pipe' })
    // oxlint-disable-next-line node/no-sync
    execSync('git -c user.name=test -c user.email=test@test commit --allow-empty -m init', {
      cwd: tmp,
      stdio: 'pipe'
    })
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'dirty.txt'), 'dirty')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'test', private: true })
    )
    const saved = process.cwd()
    process.chdir(tmp)
    await fix()
    process.chdir(saved)
    // oxlint-disable-next-line node/no-sync
    expect(existsSync(lockFile)).toBe(false)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  }, 30_000)
})
describe('fix() via CLI', () => {
  test('fix --help or unknown falls through to guide', () => {
    const cliPath = join(import.meta.dirname, '..', '..', 'dist', 'cli.mjs')
    // oxlint-disable-next-line node/no-sync
    const out = execSync(`bun ${cliPath} fixxx`, { encoding: 'utf8', timeout: 10_000 }).trim()
    expect(out).toContain('commands:')
  })
})
