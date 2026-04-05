import { describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getCodeCommitsSince,
  getHeadCommit,
  isCheckRunning,
  readCheckResult,
  spawnBackgroundCheck,
  writeCheckResult
} from '../check-cache.js'
const makeTmp = () => mkdtempSync(join(tmpdir(), 'pm4ai-cc-'))
const leadingSepRe = /^--/u
const toSafeName = (p: string) => p.replaceAll('/', '--').replace(leadingSepRe, '')
describe('writeCheckResult + readCheckResult', () => {
  test('writes and reads back a passing result', () => {
    const tmp = makeTmp()
    writeCheckResult({ pass: true, projectPath: tmp, violations: 0 })
    const result = readCheckResult(tmp)
    expect(result).toBeDefined()
    expect(result?.pass).toBe(true)
    expect(result?.violations).toBe(0)
    expect(result?.at).toBeDefined()
    rmSync(tmp, { recursive: true })
  })
  test('writes and reads back a failing result', () => {
    const tmp = makeTmp()
    writeCheckResult({ pass: false, projectPath: tmp, summary: 'lint failed', violations: 5 })
    const result = readCheckResult(tmp)
    expect(result?.pass).toBe(false)
    expect(result?.violations).toBe(5)
    expect(result?.summary).toBe('lint failed')
    rmSync(tmp, { recursive: true })
  })
  test('returns undefined when no result exists', () => {
    const tmp = makeTmp()
    expect(readCheckResult(tmp)).toBeUndefined()
    rmSync(tmp, { recursive: true })
  })
  test('overwrites previous result', () => {
    const tmp = makeTmp()
    writeCheckResult({ pass: true, projectPath: tmp, violations: 0 })
    writeCheckResult({ pass: false, projectPath: tmp, summary: 'broke', violations: 3 })
    const result = readCheckResult(tmp)
    expect(result?.pass).toBe(false)
    expect(result?.violations).toBe(3)
    rmSync(tmp, { recursive: true })
  })
  test('different paths produce different cache files', () => {
    const tmp1 = makeTmp()
    const tmp2 = makeTmp()
    writeCheckResult({ pass: true, projectPath: tmp1, violations: 0 })
    writeCheckResult({ pass: false, projectPath: tmp2, violations: 7 })
    expect(readCheckResult(tmp1)?.pass).toBe(true)
    expect(readCheckResult(tmp2)?.pass).toBe(false)
    rmSync(tmp1, { recursive: true })
    rmSync(tmp2, { recursive: true })
  })
})
describe('getHeadCommit', () => {
  test('returns commit hash for git repo', () => {
    const tmp = makeTmp()
    execSync('git init', { cwd: tmp, stdio: 'pipe' })
    execSync('git -c user.name=test -c user.email=test@test commit --allow-empty -m init', { cwd: tmp, stdio: 'pipe' })
    const commit = getHeadCommit(tmp)
    expect(commit.length).toBe(40)
    rmSync(tmp, { recursive: true })
  })
  test('returns empty string for non-git directory', () => {
    const tmp = makeTmp()
    expect(getHeadCommit(tmp)).toBe('')
    rmSync(tmp, { recursive: true })
  })
})
describe('getCodeCommitsSince', () => {
  test('returns 0 for current commit', () => {
    const tmp = makeTmp()
    execSync('git init', { cwd: tmp, stdio: 'pipe' })
    execSync('git -c user.name=test -c user.email=test@test commit --allow-empty -m init', { cwd: tmp, stdio: 'pipe' })
    const commit = getHeadCommit(tmp)
    expect(getCodeCommitsSince(tmp, commit)).toBe(0)
    rmSync(tmp, { recursive: true })
  })
  test('returns -1 for empty commit', () => {
    const tmp = makeTmp()
    expect(getCodeCommitsSince(tmp, '')).toBe(-1)
    rmSync(tmp, { recursive: true })
  })
  test('counts code commits excluding CLAUDE.md', () => {
    const tmp = makeTmp()
    execSync('git init', { cwd: tmp, stdio: 'pipe' })
    writeFileSync(join(tmp, 'code.ts'), 'const x = 1')
    execSync('git add . && git -c user.name=test -c user.email=test@test commit -m first', { cwd: tmp, stdio: 'pipe' })
    const base = getHeadCommit(tmp)
    writeFileSync(join(tmp, 'CLAUDE.md'), 'generated')
    execSync('git add . && git -c user.name=test -c user.email=test@test commit -m claude', { cwd: tmp, stdio: 'pipe' })
    expect(getCodeCommitsSince(tmp, base)).toBe(0)
    writeFileSync(join(tmp, 'code.ts'), 'const x = 2')
    execSync('git add . && git -c user.name=test -c user.email=test@test commit -m code', { cwd: tmp, stdio: 'pipe' })
    expect(getCodeCommitsSince(tmp, base)).toBe(1)
    rmSync(tmp, { recursive: true })
  })
})
describe('isCheckRunning', () => {
  test('returns false when no lock', () => {
    const tmp = makeTmp()
    expect(isCheckRunning(tmp)).toBe(false)
    rmSync(tmp, { recursive: true })
  })
  test('returns true when lock exists with alive PID', () => {
    const tmp = makeTmp()
    const dir = join(homedir(), '.pm4ai', 'checks')
    mkdirSync(dir, { recursive: true })
    const safeName = toSafeName(tmp)
    const lp = join(dir, `${safeName}.lock`)
    writeFileSync(lp, JSON.stringify({ at: new Date().toISOString(), pid: process.pid }))
    expect(isCheckRunning(tmp)).toBe(true)
    rmSync(lp, { force: true })
    rmSync(tmp, { recursive: true })
  })
  test('returns false and cleans up stale lock', () => {
    const tmp = makeTmp()
    const dir = join(homedir(), '.pm4ai', 'checks')
    mkdirSync(dir, { recursive: true })
    const safeName = toSafeName(tmp)
    const lp = join(dir, `${safeName}.lock`)
    writeFileSync(lp, JSON.stringify({ at: new Date(0).toISOString(), pid: 999_999 }))
    expect(isCheckRunning(tmp)).toBe(false)
    expect(existsSync(lp)).toBe(false)
    rmSync(tmp, { recursive: true })
  })
  test('returns false and cleans up corrupt lock', () => {
    const tmp = makeTmp()
    const dir = join(homedir(), '.pm4ai', 'checks')
    mkdirSync(dir, { recursive: true })
    const safeName = toSafeName(tmp)
    const lp = join(dir, `${safeName}.lock`)
    writeFileSync(lp, 'not json')
    expect(isCheckRunning(tmp)).toBe(false)
    expect(existsSync(lp)).toBe(false)
    rmSync(tmp, { recursive: true })
  })
})
describe('spawnBackgroundCheck', () => {
  test('does not throw for valid project', () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true, scripts: { check: 'true' } }))
    expect(() => spawnBackgroundCheck(tmp)).not.toThrow()
    rmSync(tmp, { recursive: true })
  })
  test('skips when check already running', () => {
    const tmp = makeTmp()
    const dir = join(homedir(), '.pm4ai', 'checks')
    mkdirSync(dir, { recursive: true })
    const safeName = toSafeName(tmp)
    const lp = join(dir, `${safeName}.lock`)
    writeFileSync(lp, JSON.stringify({ at: new Date().toISOString(), pid: process.pid }))
    expect(() => spawnBackgroundCheck(tmp)).not.toThrow()
    rmSync(lp, { force: true })
    rmSync(tmp, { recursive: true })
  })
})
