import { $, file, write } from 'bun'
import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getCodeCommitsSince,
  getHeadCommit,
  isCheckRunning,
  readCheckResult,
  spawnBackgroundCheck,
  writeCheckResult
} from '../check-cache.js'
import { statePath } from '../state-dir.js'

const makeTmp = async () => mkdtemp(join(tmpdir(), 'pm4ai-cc-'))
const leadingSepRe = /^--/u
const toSafeName = (p: string) => p.replaceAll('/', '--').replace(leadingSepRe, '')
describe('writeCheckResult + readCheckResult', () => {
  test('writes and reads back a passing result', async () => {
    const tmp = await makeTmp()
    await writeCheckResult({ pass: true, projectPath: tmp, violations: 0 })
    const result = await readCheckResult(tmp)
    expect(result).toBeDefined()
    expect(result?.pass).toBe(true)
    expect(result?.violations).toBe(0)
    expect(result?.at).toBeDefined()
    await rm(tmp, { recursive: true })
  })
  test('writes and reads back a failing result', async () => {
    const tmp = await makeTmp()
    await writeCheckResult({ pass: false, projectPath: tmp, summary: 'lint failed', violations: 5 })
    const result = await readCheckResult(tmp)
    expect(result?.pass).toBe(false)
    expect(result?.violations).toBe(5)
    expect(result?.summary).toBe('lint failed')
    await rm(tmp, { recursive: true })
  })
  test('returns undefined when no result exists', async () => {
    const tmp = await makeTmp()
    expect(await readCheckResult(tmp)).toBeUndefined()
    await rm(tmp, { recursive: true })
  })
  test('overwrites previous result', async () => {
    const tmp = await makeTmp()
    await writeCheckResult({ pass: true, projectPath: tmp, violations: 0 })
    await writeCheckResult({ pass: false, projectPath: tmp, summary: 'broke', violations: 3 })
    const result = await readCheckResult(tmp)
    expect(result?.pass).toBe(false)
    expect(result?.violations).toBe(3)
    await rm(tmp, { recursive: true })
  })
  test('different paths produce different cache files', async () => {
    const tmp1 = await makeTmp()
    const tmp2 = await makeTmp()
    await writeCheckResult({ pass: true, projectPath: tmp1, violations: 0 })
    await writeCheckResult({ pass: false, projectPath: tmp2, violations: 7 })
    expect((await readCheckResult(tmp1))?.pass).toBe(true)
    expect((await readCheckResult(tmp2))?.pass).toBe(false)
    await rm(tmp1, { recursive: true })
    await rm(tmp2, { recursive: true })
  })
})
describe('getHeadCommit', () => {
  test('returns commit hash for git repo', async () => {
    const tmp = await makeTmp()
    await $`git init`.cwd(tmp).quiet().nothrow()
    await $`git -c user.name=test -c user.email=test@test commit --allow-empty -m init`.cwd(tmp).quiet().nothrow()
    const commit = await getHeadCommit(tmp)
    expect(commit.length).toBe(40)
    await rm(tmp, { recursive: true })
  })
  test('returns empty string for non-git directory', async () => {
    const tmp = await makeTmp()
    expect(await getHeadCommit(tmp)).toBe('')
    await rm(tmp, { recursive: true })
  })
})
describe('getCodeCommitsSince', () => {
  test('returns 0 for current commit', async () => {
    const tmp = await makeTmp()
    await $`git init`.cwd(tmp).quiet().nothrow()
    await $`git -c user.name=test -c user.email=test@test commit --allow-empty -m init`.cwd(tmp).quiet().nothrow()
    const commit = await getHeadCommit(tmp)
    expect(await getCodeCommitsSince(tmp, commit)).toBe(0)
    await rm(tmp, { recursive: true })
  })
  test('returns -1 for empty commit', async () => {
    const tmp = await makeTmp()
    expect(await getCodeCommitsSince(tmp, '')).toBe(-1)
    await rm(tmp, { recursive: true })
  })
  test('counts code commits excluding CLAUDE.md', async () => {
    const tmp = await makeTmp()
    await $`git init`.cwd(tmp).quiet().nothrow()
    await write(join(tmp, 'code.ts'), 'const x = 1')
    await $`git add . && git -c user.name=test -c user.email=test@test commit -m first`.cwd(tmp).quiet().nothrow()
    const base = await getHeadCommit(tmp)
    await write(join(tmp, 'CLAUDE.md'), 'generated')
    await $`git add . && git -c user.name=test -c user.email=test@test commit -m claude`.cwd(tmp).quiet().nothrow()
    expect(await getCodeCommitsSince(tmp, base)).toBe(0)
    await write(join(tmp, 'code.ts'), 'const x = 2')
    await $`git add . && git -c user.name=test -c user.email=test@test commit -m code`.cwd(tmp).quiet().nothrow()
    expect(await getCodeCommitsSince(tmp, base)).toBe(1)
    await rm(tmp, { recursive: true })
  })
})
describe('isCheckRunning', () => {
  test('returns false when no lock', async () => {
    const tmp = await makeTmp()
    expect(await isCheckRunning(tmp)).toBe(false)
    await rm(tmp, { recursive: true })
  })
  test('returns true when lock exists with alive PID', async () => {
    const tmp = await makeTmp()
    const dir = statePath('checks')
    await mkdir(dir, { recursive: true })
    const safeName = toSafeName(tmp)
    const lp = join(dir, `${safeName}.lock`)
    await write(lp, JSON.stringify({ at: new Date().toISOString(), pid: process.pid }))
    expect(await isCheckRunning(tmp)).toBe(true)
    await rm(lp, { force: true })
    await rm(tmp, { recursive: true })
  })
  test('returns false and cleans up stale lock', async () => {
    const tmp = await makeTmp()
    const dir = statePath('checks')
    await mkdir(dir, { recursive: true })
    const safeName = toSafeName(tmp)
    const lp = join(dir, `${safeName}.lock`)
    await write(lp, JSON.stringify({ at: new Date(0).toISOString(), pid: 999_999 }))
    expect(await isCheckRunning(tmp)).toBe(false)
    expect(await file(lp).exists()).toBe(false)
    await rm(tmp, { recursive: true })
  })
  test('returns false and cleans up corrupt lock', async () => {
    const tmp = await makeTmp()
    const dir = statePath('checks')
    await mkdir(dir, { recursive: true })
    const safeName = toSafeName(tmp)
    const lp = join(dir, `${safeName}.lock`)
    await write(lp, 'not json')
    expect(await isCheckRunning(tmp)).toBe(false)
    expect(await file(lp).exists()).toBe(false)
    await rm(tmp, { recursive: true })
  })
})
describe('spawnBackgroundCheck', () => {
  test('does not throw for valid project', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true, scripts: { check: 'true' } }))
    await expect(spawnBackgroundCheck(tmp)).resolves.toBeUndefined()
    await rm(tmp, { recursive: true })
  })
  test('skips when check already running', async () => {
    const tmp = await makeTmp()
    const dir = statePath('checks')
    await mkdir(dir, { recursive: true })
    const safeName = toSafeName(tmp)
    const lp = join(dir, `${safeName}.lock`)
    await write(lp, JSON.stringify({ at: new Date().toISOString(), pid: process.pid }))
    await expect(spawnBackgroundCheck(tmp)).resolves.toBeUndefined()
    await rm(lp, { force: true })
    await rm(tmp, { recursive: true })
  })
})
