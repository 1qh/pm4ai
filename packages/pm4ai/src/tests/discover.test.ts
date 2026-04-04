import { describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isCnsyncRepo } from '../discover.js'
const makeTmp = () => mkdtempSync(join(tmpdir(), 'pm4ai-discover-'))
const initGitRepo = (dir: string, remote?: string) => {
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  execSync('git -c user.name=test -c user.email=test@test commit --allow-empty -m init', { cwd: dir, stdio: 'pipe' })
  if (remote) execSync(`git remote add origin ${remote}`, { cwd: dir, stdio: 'pipe' })
}
describe('isCnsyncRepo', () => {
  test('project with readonly/ui but wrong remote is false', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'readonly', 'ui'), { recursive: true })
    initGitRepo(tmp, 'git@github.com:someone/my-project.git')
    expect(await isCnsyncRepo(tmp)).toBe(false)
    rmSync(tmp, { recursive: true })
  })
  test('project with readonly/ui and 1qh/cnsync ssh remote is true', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'readonly', 'ui'), { recursive: true })
    initGitRepo(tmp, 'git@github.com:1qh/cnsync.git')
    expect(await isCnsyncRepo(tmp)).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('project with readonly/ui and 1qh/cnsync https remote is true', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'readonly', 'ui'), { recursive: true })
    initGitRepo(tmp, 'https://github.com/1qh/cnsync.git')
    expect(await isCnsyncRepo(tmp)).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('project without readonly/ui is false regardless of remote', async () => {
    const tmp = makeTmp()
    initGitRepo(tmp, 'git@github.com:1qh/cnsync.git')
    expect(await isCnsyncRepo(tmp)).toBe(false)
    rmSync(tmp, { recursive: true })
  })
  test('project with no git remote is false', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'readonly', 'ui'), { recursive: true })
    initGitRepo(tmp)
    expect(await isCnsyncRepo(tmp)).toBe(false)
    rmSync(tmp, { recursive: true })
  })
  test('project with similar name like cnsync-fork is false', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'readonly', 'ui'), { recursive: true })
    initGitRepo(tmp, 'git@github.com:other/cnsync.git')
    expect(await isCnsyncRepo(tmp)).toBe(false)
    rmSync(tmp, { recursive: true })
  })
})
