import { $, file, write } from 'bun'
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { statePath } from '../state-dir.js'

setDefaultTimeout(30_000)
const dirExists = async (p: string): Promise<boolean> => {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}
const makeTmp = async () => mkdtemp(join(tmpdir(), 'pm4ai-cw-'))
const workerPath = join(import.meta.dirname, '..', 'check-worker.ts')
const leadingSepRe = /^--/u
const safeName = (p: string) => p.replaceAll('/', '--').replace(leadingSepRe, '')
const checksDir = statePath('checks')
describe('check-worker', () => {
  test('writes passing result for project with passing check', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, '.git'))
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true, scripts: { check: 'true' } }))
    await $`bun ${workerPath} ${tmp}`.quiet().nothrow()
    const resultFile = join(checksDir, `${safeName(tmp)}.json`)
    expect(await file(resultFile).exists()).toBe(true)
    const result = (await file(resultFile).json()) as { pass: boolean; violations: number }
    expect(result.pass).toBe(true)
    expect(result.violations).toBe(0)
    await rm(tmp, { recursive: true })
  })
  test('writes failing result for project with failing check', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, '.git'))
    await write(
      join(tmp, 'package.json'),
      JSON.stringify({ name: 'test', private: true, scripts: { check: 'echo "fail" && exit 1' } })
    )
    await $`bun ${workerPath} ${tmp}`.quiet().nothrow()
    const resultFile = join(checksDir, `${safeName(tmp)}.json`)
    const result = (await file(resultFile).json()) as { pass: boolean }
    expect(result.pass).toBe(false)
    await rm(tmp, { recursive: true })
  })
  test('cleans up lock file after execution', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, '.git'))
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true, scripts: { check: 'true' } }))
    await $`bun ${workerPath} ${tmp}`.quiet().nothrow()
    const lockFile = join(checksDir, `${safeName(tmp)}.lock`)
    expect(await file(lockFile).exists()).toBe(false)
    await rm(tmp, { recursive: true })
  })
  test('creates checks directory if missing', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, '.git'))
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true, scripts: { check: 'true' } }))
    await $`bun ${workerPath} ${tmp}`.quiet().nothrow()
    expect(await dirExists(checksDir)).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('includes commit hash when in git repo', async () => {
    const tmp = await makeTmp()
    await $`git init`.cwd(tmp).quiet().nothrow()
    await $`git -c user.name=test -c user.email=test@test commit --allow-empty -m init`.cwd(tmp).quiet().nothrow()
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true, scripts: { check: 'true' } }))
    await $`bun ${workerPath} ${tmp}`.quiet().nothrow()
    const resultFile = join(checksDir, `${safeName(tmp)}.json`)
    const result = (await file(resultFile).json()) as { commit: string }
    expect(result.commit).toHaveLength(40)
    await rm(tmp, { recursive: true })
  })
  test('throws when no project path provided', async () => {
    const proc = await $`bun ${workerPath}`.quiet().nothrow()
    expect(proc.exitCode).not.toBe(0)
  })
})
