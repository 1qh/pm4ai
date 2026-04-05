import { describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
const makeTmp = () => mkdtempSync(join(tmpdir(), 'pm4ai-cw-'))
const workerPath = join(import.meta.dirname, '..', 'check-worker.ts')
const leadingSepRe = /^--/u
const safeName = (p: string) => p.replaceAll('/', '--').replace(leadingSepRe, '')
const checksDir = join(homedir(), '.pm4ai', 'checks')
describe('check-worker', () => {
  test('writes passing result for project with passing check', () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, '.git'))
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true, scripts: { check: 'true' } }))
    execSync(`bun ${workerPath} ${tmp}`, { stdio: 'pipe' })
    const resultFile = join(checksDir, `${safeName(tmp)}.json`)
    expect(existsSync(resultFile)).toBe(true)
    const result = JSON.parse(readFileSync(resultFile, 'utf8')) as { pass: boolean; violations: number }
    expect(result.pass).toBe(true)
    expect(result.violations).toBe(0)
    rmSync(tmp, { recursive: true })
  })
  test('writes failing result for project with failing check', () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, '.git'))
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ name: 'test', private: true, scripts: { check: 'echo "fail" && exit 1' } })
    )
    execSync(`bun ${workerPath} ${tmp}`, { stdio: 'pipe' })
    const resultFile = join(checksDir, `${safeName(tmp)}.json`)
    const result = JSON.parse(readFileSync(resultFile, 'utf8')) as { pass: boolean }
    expect(result.pass).toBe(false)
    rmSync(tmp, { recursive: true })
  })
  test('cleans up lock file after execution', () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, '.git'))
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true, scripts: { check: 'true' } }))
    execSync(`bun ${workerPath} ${tmp}`, { stdio: 'pipe' })
    const lockFile = join(checksDir, `${safeName(tmp)}.lock`)
    expect(existsSync(lockFile)).toBe(false)
    rmSync(tmp, { recursive: true })
  })
  test('creates checks directory if missing', () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, '.git'))
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true, scripts: { check: 'true' } }))
    execSync(`bun ${workerPath} ${tmp}`, { stdio: 'pipe' })
    expect(existsSync(checksDir)).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('includes commit hash when in git repo', () => {
    const tmp = makeTmp()
    execSync('git init', { cwd: tmp, stdio: 'pipe' })
    execSync('git -c user.name=test -c user.email=test@test commit --allow-empty -m init', { cwd: tmp, stdio: 'pipe' })
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true, scripts: { check: 'true' } }))
    execSync(`bun ${workerPath} ${tmp}`, { stdio: 'pipe' })
    const resultFile = join(checksDir, `${safeName(tmp)}.json`)
    const result = JSON.parse(readFileSync(resultFile, 'utf8')) as { commit: string }
    expect(result.commit.length).toBe(40)
    rmSync(tmp, { recursive: true })
  })
  test('throws when no project path provided', () => {
    expect(() => execSync(`bun ${workerPath}`, { stdio: 'pipe' })).toThrow()
  })
})
