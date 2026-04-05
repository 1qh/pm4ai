import { describe, expect, test } from 'bun:test'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { maintain } from '../fix.js'
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
    rmSync(tmp, { recursive: true })
  })
  test('returns no issues when up.sh succeeds', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'up.sh'), '#!/bin/sh\nexit 0')
    const issues = await maintain(tmp)
    expect(issues.filter(i => i.type === 'up.sh')).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
  test('returns failure issue when up.sh fails', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'up.sh'), '#!/bin/sh\necho "3 errors found" >&2\nexit 1')
    const issues = await maintain(tmp)
    expect(issues.some(i => i.type === 'up.sh' && i.detail.includes('failed'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('writes check result on success', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'up.sh'), '#!/bin/sh\nexit 0')
    await maintain(tmp)
    const safeName = toFileName(tmp)
    const checkFile = join(homedir(), '.pm4ai', 'checks', `${safeName}.json`)
    expect(existsSync(checkFile)).toBe(true)
    const result = JSON.parse(readFileSync(checkFile, 'utf8')) as { pass: boolean }
    expect(result.pass).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('writes check result on failure', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'up.sh'), '#!/bin/sh\necho "5 violations" >&2\nexit 1')
    await maintain(tmp)
    const safeName = toFileName(tmp)
    const checkFile = join(homedir(), '.pm4ai', 'checks', `${safeName}.json`)
    expect(existsSync(checkFile)).toBe(true)
    const result = JSON.parse(readFileSync(checkFile, 'utf8')) as { pass: boolean; violations: number }
    expect(result.pass).toBe(false)
    expect(result.violations).toBe(5)
    rmSync(tmp, { recursive: true })
  })
  test('writes log entry', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'up.sh'), '#!/bin/sh\nexit 0')
    await maintain(tmp)
    const safeName = toFileName(tmp)
    const logFile = join(homedir(), '.pm4ai', 'logs', `${safeName}.json`)
    expect(existsSync(logFile)).toBe(true)
    rmSync(tmp, { recursive: true })
  })
})
describe('lockfile', () => {
  const lockFile = join(homedir(), '.pm4ai', 'fix.lock')
  test('atomic exclusive create prevents double acquisition', () => {
    rmSync(lockFile, { force: true })
    mkdirSync(join(homedir(), '.pm4ai'), { recursive: true })
    const fd = openSync(lockFile, 'wx')
    writeFileSync(fd, JSON.stringify({ at: new Date().toISOString(), pid: process.pid }))
    closeSync(fd)
    expect(existsSync(lockFile)).toBe(true)
    let secondAcquired = true
    try {
      const fd2 = openSync(lockFile, 'wx')
      closeSync(fd2)
    } catch {
      secondAcquired = false
    }
    expect(secondAcquired).toBe(false)
    rmSync(lockFile, { force: true })
  })
  test('stale lock with dead PID is removable', () => {
    rmSync(lockFile, { force: true })
    mkdirSync(join(homedir(), '.pm4ai'), { recursive: true })
    writeFileSync(lockFile, JSON.stringify({ at: new Date(0).toISOString(), pid: 999_999 }))
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
    rmSync(lockFile, { force: true })
    expect(existsSync(lockFile)).toBe(false)
  })
  test('lock contains valid JSON with pid and timestamp', () => {
    rmSync(lockFile, { force: true })
    mkdirSync(join(homedir(), '.pm4ai'), { recursive: true })
    const fd = openSync(lockFile, 'wx')
    writeFileSync(fd, JSON.stringify({ at: new Date().toISOString(), pid: process.pid }))
    closeSync(fd)
    const lock = JSON.parse(readFileSync(lockFile, 'utf8')) as { at: string; pid: number }
    expect(lock.pid).toBe(process.pid)
    expect(new Date(lock.at).getTime()).not.toBeNaN()
    rmSync(lockFile, { force: true })
  })
})
