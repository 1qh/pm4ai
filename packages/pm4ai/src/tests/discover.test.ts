import { $ } from 'bun'
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discover, discoverSources, isCnsyncRepo } from '../discover.js'
setDefaultTimeout(30_000)
const makeTmp = async () => mkdtemp(join(tmpdir(), 'pm4ai-discover-'))
const initGitRepo = async (dir: string, remote?: string) => {
  await $`git init`.cwd(dir).quiet().nothrow()
  await $`git -c user.name=test -c user.email=test@test commit --allow-empty -m init`.cwd(dir).quiet().nothrow()
  if (remote) await $`git remote add origin ${remote}`.cwd(dir).quiet().nothrow()
}
describe('isCnsyncRepo', () => {
  test('project with readonly/ui but wrong remote is false', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'readonly', 'ui'), { recursive: true })
    await initGitRepo(tmp, 'git@github.com:someone/my-project.git')
    expect(await isCnsyncRepo(tmp)).toBe(false)
    await rm(tmp, { recursive: true })
  })
  test('project with readonly/ui and 1qh/cnsync ssh remote is true', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'readonly', 'ui'), { recursive: true })
    await initGitRepo(tmp, 'git@github.com:1qh/cnsync.git')
    expect(await isCnsyncRepo(tmp)).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('project with readonly/ui and 1qh/cnsync https remote is true', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'readonly', 'ui'), { recursive: true })
    await initGitRepo(tmp, 'https://github.com/1qh/cnsync.git')
    expect(await isCnsyncRepo(tmp)).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('project without readonly/ui is false regardless of remote', async () => {
    const tmp = await makeTmp()
    await initGitRepo(tmp, 'git@github.com:1qh/cnsync.git')
    expect(await isCnsyncRepo(tmp)).toBe(false)
    await rm(tmp, { recursive: true })
  })
  test('project with no git remote is false', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'readonly', 'ui'), { recursive: true })
    await initGitRepo(tmp)
    expect(await isCnsyncRepo(tmp)).toBe(false)
    await rm(tmp, { recursive: true })
  })
  test('project with similar name like cnsync-fork is false', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'readonly', 'ui'), { recursive: true })
    await initGitRepo(tmp, 'git@github.com:other/cnsync.git')
    expect(await isCnsyncRepo(tmp)).toBe(false)
    await rm(tmp, { recursive: true })
  })
})
describe('discover', () => {
  const makeFakeRepos = async (root: string) => {
    const selfDir = join(root, '.pm4ai', 'repos', 'pm4ai')
    const cnsyncDir = join(root, '.pm4ai', 'repos', 'cnsync')
    await mkdir(selfDir, { recursive: true })
    await mkdir(cnsyncDir, { recursive: true })
    await initGitRepo(selfDir)
    await initGitRepo(cnsyncDir)
    await writeFile(join(selfDir, 'package.json'), JSON.stringify({ name: 'pm4ai', private: true }))
    await writeFile(join(cnsyncDir, 'package.json'), JSON.stringify({ name: 'cnsync', private: true }))
  }
  const makeProjectTree = async () => {
    const root = await makeTmp()
    await makeFakeRepos(root)
    const projectA = join(root, 'project-a')
    const projectB = join(root, 'project-b')
    await mkdir(projectA, { recursive: true })
    await mkdir(projectB, { recursive: true })
    await writeFile(join(projectA, 'turbo.json'), '{}')
    await writeFile(join(projectB, 'turbo.json'), '{}')
    await writeFile(
      join(projectA, 'package.json'),
      JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'project-a', private: true })
    )
    await writeFile(
      join(projectB, 'package.json'),
      JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'project-b', private: true })
    )
    return root
  }
  test('discovers projects with lintmax in searchRoot', async () => {
    const root = await makeProjectTree()
    const result = await discover(root)
    expect(result.consumers.length).toBeGreaterThanOrEqual(2)
    const names = result.consumers.map(c => c.name)
    expect(names).toContain('project-a')
    expect(names).toContain('project-b')
    await rm(root, { recursive: true })
  })
  test('self and cnsync are not in consumers', async () => {
    const root = await makeProjectTree()
    const result = await discover(root)
    expect(result.consumers.every(c => !c.isSelf)).toBe(true)
    expect(result.consumers.every(c => !c.isCnsync)).toBe(true)
    await rm(root, { recursive: true })
  })
  test('always returns self and cnsync', async () => {
    const root = await makeProjectTree()
    const result = await discover(root)
    expect(result.self).toBeDefined()
    expect(result.cnsync).toBeDefined()
    await rm(root, { recursive: true })
  })
  test('empty searchRoot returns no consumers', async () => {
    const root = await makeTmp()
    await makeFakeRepos(root)
    const result = await discover(root)
    expect(result.consumers).toHaveLength(0)
    await rm(root, { recursive: true })
  })
  test('ignores node_modules', async () => {
    const root = await makeTmp()
    await makeFakeRepos(root)
    await mkdir(join(root, 'node_modules', 'some-pkg'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'some-pkg', 'turbo.json'), '{}')
    await writeFile(
      join(root, 'node_modules', 'some-pkg', 'package.json'),
      JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'hidden' })
    )
    const result = await discover(root)
    expect(result.consumers.every(c => c.name !== 'hidden')).toBe(true)
    await rm(root, { recursive: true })
  })
  test('deduplicates monorepo root and sub-packages', async () => {
    const root = await makeTmp()
    await makeFakeRepos(root)
    const mono = join(root, 'my-mono')
    await mkdir(join(mono, 'packages', 'lib'), { recursive: true })
    await writeFile(join(mono, 'turbo.json'), '{}')
    await writeFile(join(mono, 'packages', 'lib', 'turbo.json'), JSON.stringify({ extends: ['//'] }))
    await writeFile(
      join(mono, 'package.json'),
      JSON.stringify({
        devDependencies: { lintmax: 'latest' },
        name: 'my-mono',
        private: true,
        workspaces: ['packages/*']
      })
    )
    await writeFile(
      join(mono, 'packages', 'lib', 'package.json'),
      JSON.stringify({ dependencies: { lintmax: 'latest' }, name: '@a/lib' })
    )
    const result = await discover(root)
    const monoPaths = result.consumers.filter(c => c.path.includes('my-mono'))
    expect(monoPaths).toHaveLength(1)
    expect(monoPaths[0]?.path).toBe(mono)
    await rm(root, { recursive: true })
  })
  test('project without lintmax dep is not discovered', async () => {
    const root = await makeTmp()
    await makeFakeRepos(root)
    const noLintmax = join(root, 'no-lintmax')
    await mkdir(noLintmax, { recursive: true })
    await writeFile(join(noLintmax, 'turbo.json'), '{}')
    await writeFile(join(noLintmax, 'package.json'), JSON.stringify({ name: 'no-lintmax', private: true }))
    const result = await discover(root)
    expect(result.consumers.every(c => c.name !== 'no-lintmax')).toBe(true)
    await rm(root, { recursive: true })
  })
  test('project without turbo.json is not discovered', async () => {
    const root = await makeTmp()
    await makeFakeRepos(root)
    const noTurbo = join(root, 'no-turbo')
    await mkdir(noTurbo, { recursive: true })
    await writeFile(
      join(noTurbo, 'package.json'),
      JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'no-turbo' })
    )
    const result = await discover(root)
    expect(result.consumers.every(c => c.name !== 'no-turbo')).toBe(true)
    await rm(root, { recursive: true })
  })
  test('turbo.jsonc is also recognized', async () => {
    const root = await makeTmp()
    await makeFakeRepos(root)
    const proj = join(root, 'jsonc-proj')
    await mkdir(proj, { recursive: true })
    await writeFile(join(proj, 'turbo.jsonc'), '{}')
    await writeFile(
      join(proj, 'package.json'),
      JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'jsonc-proj' })
    )
    const result = await discover(root)
    expect(result.consumers.some(c => c.name === 'jsonc-proj')).toBe(true)
    await rm(root, { recursive: true })
  })
  test('lintmax in dependencies (not devDeps) is still discovered', async () => {
    const root = await makeTmp()
    await makeFakeRepos(root)
    const proj = join(root, 'uses-lintmax')
    await mkdir(proj, { recursive: true })
    await writeFile(join(proj, 'turbo.json'), '{}')
    await writeFile(
      join(proj, 'package.json'),
      JSON.stringify({ dependencies: { lintmax: 'latest' }, name: 'uses-lintmax' })
    )
    const result = await discover(root)
    expect(result.consumers.some(c => c.name === 'uses-lintmax')).toBe(true)
    await rm(root, { recursive: true })
  })
  test('self path points to pm4ai', async () => {
    const root = await makeProjectTree()
    const result = await discover(root)
    expect(result.self.path).toContain('pm4ai')
    await rm(root, { recursive: true })
  })
  test('cnsync path points to cnsync', async () => {
    const root = await makeProjectTree()
    const result = await discover(root)
    expect(result.cnsync.path).toContain('cnsync')
    await rm(root, { recursive: true })
  })
})
describe('discoverSources', () => {
  test('finds self and cnsync from repos dir', async () => {
    const root = await makeTmp()
    const selfDir = join(root, '.pm4ai', 'repos', 'pm4ai')
    const cnsyncDir = join(root, '.pm4ai', 'repos', 'cnsync')
    await mkdir(selfDir, { recursive: true })
    await mkdir(cnsyncDir, { recursive: true })
    await initGitRepo(selfDir)
    await initGitRepo(cnsyncDir)
    await writeFile(join(selfDir, 'package.json'), JSON.stringify({ name: 'pm4ai' }))
    await writeFile(join(cnsyncDir, 'package.json'), JSON.stringify({ name: 'cnsync' }))
    const result = await discoverSources(root)
    expect(result.self).toBeDefined()
    expect(result.cnsync).toBeDefined()
    expect(result.self.path).toBe(selfDir)
    expect(result.cnsync.path).toBe(cnsyncDir)
    await rm(root, { recursive: true })
  })
  test('self is marked isSelf true', async () => {
    const root = await makeTmp()
    const selfDir = join(root, '.pm4ai', 'repos', 'pm4ai')
    const cnsyncDir = join(root, '.pm4ai', 'repos', 'cnsync')
    await mkdir(selfDir, { recursive: true })
    await mkdir(cnsyncDir, { recursive: true })
    await initGitRepo(selfDir)
    await initGitRepo(cnsyncDir)
    await writeFile(join(selfDir, 'package.json'), JSON.stringify({ name: 'pm4ai' }))
    await writeFile(join(cnsyncDir, 'package.json'), JSON.stringify({ name: 'cnsync' }))
    const result = await discoverSources(root)
    expect(result.self.isSelf).toBe(true)
    expect(result.cnsync.isCnsync).toBe(true)
    await rm(root, { recursive: true })
  })
  test('falls back to clone path when repos not found', async () => {
    const root = await makeTmp()
    const reposDir = join(root, '.pm4ai', 'repos')
    const cloneSrc = await makeTmp()
    await $`git init --bare ${join(cloneSrc, 'pm4ai.git')}`.quiet().nothrow()
    await $`git init --bare ${join(cloneSrc, 'cnsync.git')}`.quiet().nothrow()
    process.env.PM4AI_CLONE_BASE = cloneSrc
    try {
      const result = await discoverSources(root)
      expect(result.self.path).toBe(join(reposDir, 'pm4ai'))
      expect(result.cnsync.path).toBe(join(reposDir, 'cnsync'))
    } finally {
      delete process.env.PM4AI_CLONE_BASE
      await rm(root, { recursive: true })
      await rm(cloneSrc, { recursive: true })
    }
  })
})
