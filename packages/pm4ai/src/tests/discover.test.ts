import { describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discover, discoverSources, isCnsyncRepo } from '../discover.js'
// oxlint-disable-next-line node/no-sync
const makeTmp = () => mkdtempSync(join(tmpdir(), 'pm4ai-discover-'))
const initGitRepo = (dir: string, remote?: string) => {
  // oxlint-disable-next-line node/no-sync
  execSync('git init', { cwd: dir, stdio: 'pipe' })
  // oxlint-disable-next-line node/no-sync
  execSync('git -c user.name=test -c user.email=test@test commit --allow-empty -m init', { cwd: dir, stdio: 'pipe' })
  // oxlint-disable-next-line node/no-sync
  if (remote) execSync(`git remote add origin ${remote}`, { cwd: dir, stdio: 'pipe' })
}
describe('isCnsyncRepo', () => {
  test('project with readonly/ui but wrong remote is false', async () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    mkdirSync(join(tmp, 'readonly', 'ui'), { recursive: true })
    initGitRepo(tmp, 'git@github.com:someone/my-project.git')
    expect(await isCnsyncRepo(tmp)).toBe(false)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('project with readonly/ui and 1qh/cnsync ssh remote is true', async () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    mkdirSync(join(tmp, 'readonly', 'ui'), { recursive: true })
    initGitRepo(tmp, 'git@github.com:1qh/cnsync.git')
    expect(await isCnsyncRepo(tmp)).toBe(true)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('project with readonly/ui and 1qh/cnsync https remote is true', async () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    mkdirSync(join(tmp, 'readonly', 'ui'), { recursive: true })
    initGitRepo(tmp, 'https://github.com/1qh/cnsync.git')
    expect(await isCnsyncRepo(tmp)).toBe(true)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('project without readonly/ui is false regardless of remote', async () => {
    const tmp = makeTmp()
    initGitRepo(tmp, 'git@github.com:1qh/cnsync.git')
    expect(await isCnsyncRepo(tmp)).toBe(false)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('project with no git remote is false', async () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    mkdirSync(join(tmp, 'readonly', 'ui'), { recursive: true })
    initGitRepo(tmp)
    expect(await isCnsyncRepo(tmp)).toBe(false)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
  test('project with similar name like cnsync-fork is false', async () => {
    const tmp = makeTmp()
    // oxlint-disable-next-line node/no-sync
    mkdirSync(join(tmp, 'readonly', 'ui'), { recursive: true })
    initGitRepo(tmp, 'git@github.com:other/cnsync.git')
    expect(await isCnsyncRepo(tmp)).toBe(false)
    // oxlint-disable-next-line node/no-sync
    rmSync(tmp, { recursive: true })
  })
})
describe('discover', () => {
  const makeFakeRepos = (root: string) => {
    const selfDir = join(root, '.pm4ai', 'repos', 'pm4ai')
    const cnsyncDir = join(root, '.pm4ai', 'repos', 'cnsync')
    // oxlint-disable-next-line node/no-sync
    mkdirSync(selfDir, { recursive: true })
    // oxlint-disable-next-line node/no-sync
    mkdirSync(cnsyncDir, { recursive: true })
    initGitRepo(selfDir)
    initGitRepo(cnsyncDir)
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(selfDir, 'package.json'), JSON.stringify({ name: 'pm4ai', private: true }))
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(cnsyncDir, 'package.json'), JSON.stringify({ name: 'cnsync', private: true }))
  }
  const makeProjectTree = () => {
    const root = makeTmp()
    makeFakeRepos(root)
    const projectA = join(root, 'project-a')
    const projectB = join(root, 'project-b')
    // oxlint-disable-next-line node/no-sync
    mkdirSync(projectA, { recursive: true })
    // oxlint-disable-next-line node/no-sync
    mkdirSync(projectB, { recursive: true })
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(projectA, 'turbo.json'), '{}')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(projectB, 'turbo.json'), '{}')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(
      join(projectA, 'package.json'),
      JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'project-a', private: true })
    )
    // oxlint-disable-next-line node/no-sync
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
    // oxlint-disable-next-line node/no-sync
    rmSync(root, { recursive: true })
  })
  test('self and cnsync are not in consumers', async () => {
    const root = makeProjectTree()
    const result = await discover(root)
    expect(result.consumers.every(c => !c.isSelf)).toBe(true)
    expect(result.consumers.every(c => !c.isCnsync)).toBe(true)
    // oxlint-disable-next-line node/no-sync
    rmSync(root, { recursive: true })
  })
  test('always returns self and cnsync', async () => {
    const root = makeProjectTree()
    const result = await discover(root)
    expect(result.self).toBeDefined()
    expect(result.cnsync).toBeDefined()
    // oxlint-disable-next-line node/no-sync
    rmSync(root, { recursive: true })
  })
  test('empty searchRoot returns no consumers', async () => {
    const root = makeTmp()
    makeFakeRepos(root)
    const result = await discover(root)
    expect(result.consumers).toHaveLength(0)
    // oxlint-disable-next-line node/no-sync
    rmSync(root, { recursive: true })
  })
  test('ignores node_modules', async () => {
    const root = makeTmp()
    makeFakeRepos(root)
    // oxlint-disable-next-line node/no-sync
    mkdirSync(join(root, 'node_modules', 'some-pkg'), { recursive: true })
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(root, 'node_modules', 'some-pkg', 'turbo.json'), '{}')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(
      join(root, 'node_modules', 'some-pkg', 'package.json'),
      JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'hidden' })
    )
    const result = await discover(root)
    expect(result.consumers.every(c => c.name !== 'hidden')).toBe(true)
    // oxlint-disable-next-line node/no-sync
    rmSync(root, { recursive: true })
  })
  test('deduplicates monorepo root and sub-packages', async () => {
    const root = makeTmp()
    makeFakeRepos(root)
    const mono = join(root, 'my-mono')
    // oxlint-disable-next-line node/no-sync
    mkdirSync(join(mono, 'packages', 'lib'), { recursive: true })
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(mono, 'turbo.json'), '{}')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(mono, 'packages', 'lib', 'turbo.json'), JSON.stringify({ extends: ['//'] }))
    // oxlint-disable-next-line node/no-sync
    writeFileSync(
      join(mono, 'package.json'),
      JSON.stringify({
        devDependencies: { lintmax: 'latest' },
        name: 'my-mono',
        private: true,
        workspaces: ['packages/*']
      })
    )
    // oxlint-disable-next-line node/no-sync
    writeFileSync(
      join(mono, 'packages', 'lib', 'package.json'),
      JSON.stringify({ dependencies: { lintmax: 'latest' }, name: '@a/lib' })
    )
    const result = await discover(root)
    const monoPaths = result.consumers.filter(c => c.path.includes('my-mono'))
    expect(monoPaths).toHaveLength(1)
    expect(monoPaths[0]?.path).toBe(mono)
    // oxlint-disable-next-line node/no-sync
    rmSync(root, { recursive: true })
  })
  test('project without lintmax dep is not discovered', async () => {
    const root = makeTmp()
    makeFakeRepos(root)
    const noLintmax = join(root, 'no-lintmax')
    // oxlint-disable-next-line node/no-sync
    mkdirSync(noLintmax, { recursive: true })
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(noLintmax, 'turbo.json'), '{}')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(noLintmax, 'package.json'), JSON.stringify({ name: 'no-lintmax', private: true }))
    const result = await discover(root)
    expect(result.consumers.every(c => c.name !== 'no-lintmax')).toBe(true)
    // oxlint-disable-next-line node/no-sync
    rmSync(root, { recursive: true })
  })
  test('project without turbo.json is not discovered', async () => {
    const root = makeTmp()
    makeFakeRepos(root)
    const noTurbo = join(root, 'no-turbo')
    // oxlint-disable-next-line node/no-sync
    mkdirSync(noTurbo, { recursive: true })
    // oxlint-disable-next-line node/no-sync
    writeFileSync(
      join(noTurbo, 'package.json'),
      JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'no-turbo' })
    )
    const result = await discover(root)
    expect(result.consumers.every(c => c.name !== 'no-turbo')).toBe(true)
    // oxlint-disable-next-line node/no-sync
    rmSync(root, { recursive: true })
  })
  test('turbo.jsonc is also recognized', async () => {
    const root = makeTmp()
    makeFakeRepos(root)
    const proj = join(root, 'jsonc-proj')
    // oxlint-disable-next-line node/no-sync
    mkdirSync(proj, { recursive: true })
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(proj, 'turbo.jsonc'), '{}')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(
      join(proj, 'package.json'),
      JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'jsonc-proj' })
    )
    const result = await discover(root)
    expect(result.consumers.some(c => c.name === 'jsonc-proj')).toBe(true)
    // oxlint-disable-next-line node/no-sync
    rmSync(root, { recursive: true })
  })
  test('lintmax in dependencies (not devDeps) is still discovered', async () => {
    const root = makeTmp()
    makeFakeRepos(root)
    const proj = join(root, 'uses-lintmax')
    // oxlint-disable-next-line node/no-sync
    mkdirSync(proj, { recursive: true })
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(proj, 'turbo.json'), '{}')
    // oxlint-disable-next-line node/no-sync
    writeFileSync(
      join(proj, 'package.json'),
      JSON.stringify({ dependencies: { lintmax: 'latest' }, name: 'uses-lintmax' })
    )
    const result = await discover(root)
    expect(result.consumers.some(c => c.name === 'uses-lintmax')).toBe(true)
    // oxlint-disable-next-line node/no-sync
    rmSync(root, { recursive: true })
  })
  test('self path points to pm4ai', async () => {
    const root = makeProjectTree()
    const result = await discover(root)
    expect(result.self.path).toContain('pm4ai')
    // oxlint-disable-next-line node/no-sync
    rmSync(root, { recursive: true })
  })
  test('cnsync path points to cnsync', async () => {
    const root = makeProjectTree()
    const result = await discover(root)
    expect(result.cnsync.path).toContain('cnsync')
    // oxlint-disable-next-line node/no-sync
    rmSync(root, { recursive: true })
  })
})
describe('discoverSources', () => {
  test('finds self and cnsync from repos dir', async () => {
    const root = makeTmp()
    const selfDir = join(root, '.pm4ai', 'repos', 'pm4ai')
    const cnsyncDir = join(root, '.pm4ai', 'repos', 'cnsync')
    // oxlint-disable-next-line node/no-sync
    mkdirSync(selfDir, { recursive: true })
    // oxlint-disable-next-line node/no-sync
    mkdirSync(cnsyncDir, { recursive: true })
    initGitRepo(selfDir)
    initGitRepo(cnsyncDir)
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(selfDir, 'package.json'), JSON.stringify({ name: 'pm4ai' }))
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(cnsyncDir, 'package.json'), JSON.stringify({ name: 'cnsync' }))
    const result = await discoverSources(root)
    expect(result.self).toBeDefined()
    expect(result.cnsync).toBeDefined()
    expect(result.self.path).toBe(selfDir)
    expect(result.cnsync.path).toBe(cnsyncDir)
    // oxlint-disable-next-line node/no-sync
    rmSync(root, { recursive: true })
  })
  test('self is marked isSelf true', async () => {
    const root = makeTmp()
    const selfDir = join(root, '.pm4ai', 'repos', 'pm4ai')
    const cnsyncDir = join(root, '.pm4ai', 'repos', 'cnsync')
    // oxlint-disable-next-line node/no-sync
    mkdirSync(selfDir, { recursive: true })
    // oxlint-disable-next-line node/no-sync
    mkdirSync(cnsyncDir, { recursive: true })
    initGitRepo(selfDir)
    initGitRepo(cnsyncDir)
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(selfDir, 'package.json'), JSON.stringify({ name: 'pm4ai' }))
    // oxlint-disable-next-line node/no-sync
    writeFileSync(join(cnsyncDir, 'package.json'), JSON.stringify({ name: 'cnsync' }))
    const result = await discoverSources(root)
    expect(result.self.isSelf).toBe(true)
    expect(result.cnsync.isCnsync).toBe(true)
    // oxlint-disable-next-line node/no-sync
    rmSync(root, { recursive: true })
  })
  test('falls back to clone path when repos not found', async () => {
    const root = makeTmp()
    const reposDir = join(root, '.pm4ai', 'repos')
    const result = await discoverSources(root)
    expect(result.self.path).toBe(join(reposDir, 'pm4ai'))
    expect(result.cnsync.path).toBe(join(reposDir, 'cnsync'))
    // oxlint-disable-next-line node/no-sync
    rmSync(root, { recursive: true })
  }, 30_000)
})
