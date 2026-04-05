import { describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discover, isCnsyncRepo } from '../discover.js'
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
describe('discover', () => {
  const makeFakeRepos = (root: string) => {
    const selfDir = join(root, '.pm4ai', 'repos', 'pm4ai')
    const cnsyncDir = join(root, '.pm4ai', 'repos', 'cnsync')
    mkdirSync(selfDir, { recursive: true })
    mkdirSync(cnsyncDir, { recursive: true })
    initGitRepo(selfDir)
    initGitRepo(cnsyncDir)
    writeFileSync(join(selfDir, 'package.json'), JSON.stringify({ name: 'pm4ai', private: true }))
    writeFileSync(join(cnsyncDir, 'package.json'), JSON.stringify({ name: 'cnsync', private: true }))
  }
  const makeProjectTree = () => {
    const root = makeTmp()
    makeFakeRepos(root)
    const projectA = join(root, 'project-a')
    const projectB = join(root, 'project-b')
    mkdirSync(projectA, { recursive: true })
    mkdirSync(projectB, { recursive: true })
    writeFileSync(
      join(projectA, 'package.json'),
      JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'project-a', private: true })
    )
    writeFileSync(
      join(projectB, 'package.json'),
      JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'project-b', private: true })
    )
    return root
  }
  test('discovers projects with lintmax in searchRoot', async () => {
    const root = makeProjectTree()
    const result = await discover(root)
    expect(result.consumers.length).toBeGreaterThanOrEqual(2)
    const names = result.consumers.map(c => c.name)
    expect(names).toContain('project-a')
    expect(names).toContain('project-b')
    rmSync(root, { recursive: true })
  })
  test('self and cnsync are not in consumers', async () => {
    const root = makeProjectTree()
    const result = await discover(root)
    expect(result.consumers.every(c => !c.isSelf)).toBe(true)
    expect(result.consumers.every(c => !c.isCnsync)).toBe(true)
    rmSync(root, { recursive: true })
  })
  test('always returns self and cnsync', async () => {
    const root = makeProjectTree()
    const result = await discover(root)
    expect(result.self).toBeDefined()
    expect(result.cnsync).toBeDefined()
    rmSync(root, { recursive: true })
  })
  test('empty searchRoot returns no consumers', async () => {
    const root = makeTmp()
    makeFakeRepos(root)
    const result = await discover(root)
    expect(result.consumers).toHaveLength(0)
    rmSync(root, { recursive: true })
  })
  test('ignores node_modules', async () => {
    const root = makeTmp()
    makeFakeRepos(root)
    mkdirSync(join(root, 'node_modules', 'some-pkg'), { recursive: true })
    writeFileSync(
      join(root, 'node_modules', 'some-pkg', 'package.json'),
      JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'hidden' })
    )
    const result = await discover(root)
    expect(result.consumers.every(c => c.name !== 'hidden')).toBe(true)
    rmSync(root, { recursive: true })
  })
  test('deduplicates monorepo root and sub-packages', async () => {
    const root = makeTmp()
    makeFakeRepos(root)
    const mono = join(root, 'my-mono')
    mkdirSync(join(mono, 'packages', 'lib'), { recursive: true })
    writeFileSync(
      join(mono, 'package.json'),
      JSON.stringify({
        devDependencies: { lintmax: 'latest' },
        name: 'my-mono',
        private: true,
        workspaces: ['packages/*']
      })
    )
    writeFileSync(
      join(mono, 'packages', 'lib', 'package.json'),
      JSON.stringify({ dependencies: { lintmax: 'latest' }, name: '@a/lib' })
    )
    const result = await discover(root)
    const monoPaths = result.consumers.filter(c => c.path.includes('my-mono'))
    expect(monoPaths).toHaveLength(1)
    expect(monoPaths[0]?.path).toBe(mono)
    rmSync(root, { recursive: true })
  })
})
