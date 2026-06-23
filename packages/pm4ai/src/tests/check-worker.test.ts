import { describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
// oxlint-disable-next-line node/no-sync
const makeTmp = () => mkdtempSync(join(tmpdir(), 'pm4ai-cw-'))
const workerPath = join(import.meta.dirname, '..', 'check-worker.ts')
const leadingSepRe = /^--/u
const safeName = (p: string) => p.replaceAll('/', '--').replace(leadingSepRe, '')
const checksDir = join(homedir(), '.pm4ai', 'checks')
describe('check-worker', () => {
  test('writes passing result for project with passing check', () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    mkdirSync(join(tmp, '.git'))
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true, scripts: { check: 'true' } }))
    // oxlint-disable-next-line node/no-sync
    execSync(`bun ${workerPath} ${tmp}`, { stdio: 'pipe' })
    const resultFile = join(checksDir, `${safeName(tmp)}.json`)
    // oxlint-disable-next-line node/no-sync
    expect(existsSync(resultFile)).toBe(true)
    // oxlint-disable-next-line node/no-sync
    const result = JSON.parse(readFileSync(resultFile, 'utf8')) as { pass: boolean; violations: number }
    expect(result.pass).toBe(true)
    expect(result.violations).toBe(0)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('writes failing result for project with failing check', () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    mkdirSync(join(tmp, '.git'))
    // oxlint-disable-next-line node/no-sync
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ name: 'test', private: true, scripts: { check: 'echo "fail" && exit 1' } })
    )
    // oxlint-disable-next-line node/no-sync
    execSync(`bun ${workerPath} ${tmp}`, { stdio: 'pipe' })
    const resultFile = join(checksDir, `${safeName(tmp)}.json`)
    // oxlint-disable-next-line node/no-sync
    const result = JSON.parse(readFileSync(resultFile, 'utf8')) as { pass: boolean }
    expect(result.pass).toBe(false)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('cleans up lock file after execution', () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    mkdirSync(join(tmp, '.git'))
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true, scripts: { check: 'true' } }))
    // oxlint-disable-next-line node/no-sync
    execSync(`bun ${workerPath} ${tmp}`, { stdio: 'pipe' })
    const lockFile = join(checksDir, `${safeName(tmp)}.lock`)
    // oxlint-disable-next-line node/no-sync
    expect(existsSync(lockFile)).toBe(false)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('creates checks directory if missing', () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    mkdirSync(join(tmp, '.git'))
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true, scripts: { check: 'true' } }))
    // oxlint-disable-next-line node/no-sync
    execSync(`bun ${workerPath} ${tmp}`, { stdio: 'pipe' })
    // oxlint-disable-next-line node/no-sync
    expect(existsSync(checksDir)).toBe(true)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('includes commit hash when in git repo', () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    execSync('git init', { cwd: tmp, stdio: 'pipe' })
    // oxlint-disable-next-line node/no-sync
    execSync('git -c user.name=test -c user.email=test@test commit --allow-empty -m init', { cwd: tmp, stdio: 'pipe' })
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true, scripts: { check: 'true' } }))
    // oxlint-disable-next-line node/no-sync
    execSync(`bun ${workerPath} ${tmp}`, { stdio: 'pipe' })
    const resultFile = join(checksDir, `${safeName(tmp)}.json`)
    // oxlint-disable-next-line node/no-sync
    const result = JSON.parse(readFileSync(resultFile, 'utf8')) as { commit: string }
    expect(result.commit.length).toBe(40)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('throws when no project path provided', () => {
    // oxlint-disable-next-line node/no-sync
    expect(() => execSync(`bun ${workerPath}`, { stdio: 'pipe' })).toThrow()
  })
})
