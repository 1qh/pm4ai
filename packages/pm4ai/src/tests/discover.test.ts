import { describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discover, discoverSources, isCnsyncRepo } from '../discover.js'
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
    writeFileSync(join(projectA, 'turbo.json'), '{}')
    writeFileSync(join(projectB, 'turbo.json'), '{}')
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
    writeFileSync(join(root, 'node_modules', 'some-pkg', 'turbo.json'), '{}')
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
    writeFileSync(join(mono, 'turbo.json'), '{}')
    writeFileSync(join(mono, 'packages', 'lib', 'turbo.json'), JSON.stringify({ extends: ['//'] }))
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
  test('project without lintmax dep is not discovered', async () => {
    const root = makeTmp()
    makeFakeRepos(root)
    const noLintmax = join(root, 'no-lintmax')
    mkdirSync(noLintmax, { recursive: true })
    writeFileSync(join(noLintmax, 'turbo.json'), '{}')
    writeFileSync(join(noLintmax, 'package.json'), JSON.stringify({ name: 'no-lintmax', private: true }))
    const result = await discover(root)
    expect(result.consumers.every(c => c.name !== 'no-lintmax')).toBe(true)
    rmSync(root, { recursive: true })
  })
  test('project without turbo.json is not discovered', async () => {
    const root = makeTmp()
    makeFakeRepos(root)
    const noTurbo = join(root, 'no-turbo')
    mkdirSync(noTurbo, { recursive: true })
    writeFileSync(
      join(noTurbo, 'package.json'),
      JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'no-turbo' })
    )
    const result = await discover(root)
    expect(result.consumers.every(c => c.name !== 'no-turbo')).toBe(true)
    rmSync(root, { recursive: true })
  })
  test('turbo.jsonc is also recognized', async () => {
    const root = makeTmp()
    makeFakeRepos(root)
    const proj = join(root, 'jsonc-proj')
    mkdirSync(proj, { recursive: true })
    writeFileSync(join(proj, 'turbo.jsonc'), '{}')
    writeFileSync(
      join(proj, 'package.json'),
      JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'jsonc-proj' })
    )
    const result = await discover(root)
    expect(result.consumers.some(c => c.name === 'jsonc-proj')).toBe(true)
    rmSync(root, { recursive: true })
  })
  test('lintmax in dependencies (not devDeps) is still discovered', async () => {
    const root = makeTmp()
    makeFakeRepos(root)
    const proj = join(root, 'uses-lintmax')
    mkdirSync(proj, { recursive: true })
    writeFileSync(join(proj, 'turbo.json'), '{}')
    writeFileSync(
      join(proj, 'package.json'),
      JSON.stringify({ dependencies: { lintmax: 'latest' }, name: 'uses-lintmax' })
    )
    const result = await discover(root)
    expect(result.consumers.some(c => c.name === 'uses-lintmax')).toBe(true)
    rmSync(root, { recursive: true })
  })
  test('self path points to pm4ai', async () => {
    const root = makeProjectTree()
    const result = await discover(root)
    expect(result.self.path).toContain('pm4ai')
    rmSync(root, { recursive: true })
  })
  test('cnsync path points to cnsync', async () => {
    const root = makeProjectTree()
    const result = await discover(root)
    expect(result.cnsync.path).toContain('cnsync')
    rmSync(root, { recursive: true })
  })
})
describe('discoverSources', () => {
  test('finds self and cnsync from repos dir', async () => {
    const root = makeTmp()
    const selfDir = join(root, '.pm4ai', 'repos', 'pm4ai')
    const cnsyncDir = join(root, '.pm4ai', 'repos', 'cnsync')
    mkdirSync(selfDir, { recursive: true })
    mkdirSync(cnsyncDir, { recursive: true })
    initGitRepo(selfDir)
    initGitRepo(cnsyncDir)
    writeFileSync(join(selfDir, 'package.json'), JSON.stringify({ name: 'pm4ai' }))
    writeFileSync(join(cnsyncDir, 'package.json'), JSON.stringify({ name: 'cnsync' }))
    const result = await discoverSources(root)
    expect(result.self).toBeDefined()
    expect(result.cnsync).toBeDefined()
    expect(result.self.path).toBe(selfDir)
    expect(result.cnsync.path).toBe(cnsyncDir)
    rmSync(root, { recursive: true })
  })
  test('self is marked isSelf true', async () => {
    const root = makeTmp()
    const selfDir = join(root, '.pm4ai', 'repos', 'pm4ai')
    const cnsyncDir = join(root, '.pm4ai', 'repos', 'cnsync')
    mkdirSync(selfDir, { recursive: true })
    mkdirSync(cnsyncDir, { recursive: true })
    initGitRepo(selfDir)
    initGitRepo(cnsyncDir)
    writeFileSync(join(selfDir, 'package.json'), JSON.stringify({ name: 'pm4ai' }))
    writeFileSync(join(cnsyncDir, 'package.json'), JSON.stringify({ name: 'cnsync' }))
    const result = await discoverSources(root)
    expect(result.self.isSelf).toBe(true)
    expect(result.cnsync.isCnsync).toBe(true)
    rmSync(root, { recursive: true })
  })
  test('falls back to clone path when repos not found', async () => {
    const root = makeTmp()
    const reposDir = join(root, '.pm4ai', 'repos')
    const result = await discoverSources(root)
    expect(result.self.path).toBe(join(reposDir, 'pm4ai'))
    expect(result.cnsync.path).toBe(join(reposDir, 'cnsync'))
    rmSync(root, { recursive: true })
  }, 30_000)
})
