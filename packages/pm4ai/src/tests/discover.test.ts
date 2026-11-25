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
  test.each([
    {
      expected: false,
      remote: 'git@github.com:someone/my-project.git',
      title: 'project with readonly/ui but wrong remote is false'
    },
    {
      expected: true,
      remote: 'git@github.com:1qh/cnsync.git',
      title: 'project with readonly/ui and 1qh/cnsync ssh remote is true'
    },
    {
      expected: true,
      remote: 'https://github.com/1qh/cnsync.git',
      title: 'project with readonly/ui and 1qh/cnsync https remote is true'
    },
    { expected: false, remote: undefined, title: 'project with no git remote is false' },
    {
      expected: false,
      remote: 'git@github.com:other/cnsync.git',
      title: 'project with similar name like cnsync-fork is false'
    }
  ])('$title', async ({ expected, remote }) => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'readonly', 'ui'), { recursive: true })
    await initGitRepo(tmp, remote)
    expect(await isCnsyncRepo(tmp)).toBe(expected)
    await rm(tmp, { recursive: true })
  })
  test('project without readonly/ui is false regardless of remote', async () => {
    const tmp = await makeTmp()
    await initGitRepo(tmp, 'git@github.com:1qh/cnsync.git')
    expect(await isCnsyncRepo(tmp)).toBe(false)
    await rm(tmp, { recursive: true })
  })
})
const writeSourceRepos = async (root: string, isPrivate: boolean) => {
  const selfDir = join(root, '.pm4ai', 'repos', 'pm4ai')
  const cnsyncDir = join(root, '.pm4ai', 'repos', 'cnsync')
  await mkdir(selfDir, { recursive: true })
  await mkdir(cnsyncDir, { recursive: true })
  await initGitRepo(selfDir)
  await initGitRepo(cnsyncDir)
  await writeFile(
    join(selfDir, 'package.json'),
    JSON.stringify(isPrivate ? { name: 'pm4ai', private: true } : { name: 'pm4ai' })
  )
  await writeFile(
    join(cnsyncDir, 'package.json'),
    JSON.stringify(isPrivate ? { name: 'cnsync', private: true } : { name: 'cnsync' })
  )
  return { cnsyncDir, selfDir }
}
const makeFakeRepos = async (root: string) => {
  await writeSourceRepos(root, true)
}
const writeProject = async ({
  dir,
  manifest,
  turbo
}: {
  dir: string
  manifest: Record<string, unknown>
  turbo?: { content: string; name: string }
}) => {
  await mkdir(dir, { recursive: true })
  if (turbo) await writeFile(join(dir, turbo.name), turbo.content)
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest))
}
const plainTurbo = { content: '{}', name: 'turbo.json' }
const makeProjectTree = async () => {
  const root = await makeTmp()
  await makeFakeRepos(root)
  await writeProject({
    dir: join(root, 'project-a'),
    manifest: { devDependencies: { lintmax: 'latest' }, name: 'project-a', private: true },
    turbo: plainTurbo
  })
  await writeProject({
    dir: join(root, 'project-b'),
    manifest: { devDependencies: { lintmax: 'latest' }, name: 'project-b', private: true },
    turbo: plainTurbo
  })
  return root
}
const removeCloneFixture = async (root: string, cloneSrc: string) => {
  delete process.env.PM4AI_CLONE_BASE
  await rm(root, { recursive: true })
  await rm(cloneSrc, { recursive: true })
}
const makeBareClones = async () => {
  const cloneSrc = await makeTmp()
  await $`git init --bare ${join(cloneSrc, 'pm4ai.git')}`.quiet().nothrow()
  await $`git init --bare ${join(cloneSrc, 'cnsync.git')}`.quiet().nothrow()
  return cloneSrc
}
describe('discover', () => {
  describe('consumers', () => {
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
      await writeProject({
        dir: join(root, 'node_modules', 'some-pkg'),
        manifest: { devDependencies: { lintmax: 'latest' }, name: 'hidden' },
        turbo: plainTurbo
      })
      const result = await discover(root)
      expect(result.consumers.every(c => c.name !== 'hidden')).toBe(true)
      await rm(root, { recursive: true })
    })
    test('deduplicates monorepo root and sub-packages', async () => {
      const root = await makeTmp()
      await makeFakeRepos(root)
      const mono = join(root, 'my-mono')
      await writeProject({
        dir: mono,
        manifest: {
          devDependencies: { lintmax: 'latest' },
          name: 'my-mono',
          private: true,
          workspaces: ['packages/*']
        },
        turbo: plainTurbo
      })
      await writeProject({
        dir: join(mono, 'packages', 'lib'),
        manifest: { dependencies: { lintmax: 'latest' }, name: '@a/lib' },
        turbo: { content: JSON.stringify({ extends: ['//'] }), name: 'turbo.json' }
      })
      const result = await discover(root)
      const monoPaths = result.consumers.filter(c => c.path.includes('my-mono'))
      expect(monoPaths).toHaveLength(1)
      expect(monoPaths[0]?.path).toBe(mono)
      await rm(root, { recursive: true })
    })
  })
  describe('markers and sources', () => {
    test('project without lintmax dep is not discovered', async () => {
      const root = await makeTmp()
      await makeFakeRepos(root)
      await writeProject({
        dir: join(root, 'no-lintmax'),
        manifest: { name: 'no-lintmax', private: true },
        turbo: plainTurbo
      })
      const result = await discover(root)
      expect(result.consumers.every(c => c.name !== 'no-lintmax')).toBe(true)
      await rm(root, { recursive: true })
    })
    test('project without turbo.json is not discovered', async () => {
      const root = await makeTmp()
      await makeFakeRepos(root)
      await writeProject({
        dir: join(root, 'no-turbo'),
        manifest: { devDependencies: { lintmax: 'latest' }, name: 'no-turbo' }
      })
      const result = await discover(root)
      expect(result.consumers.every(c => c.name !== 'no-turbo')).toBe(true)
      await rm(root, { recursive: true })
    })
    test('turbo.jsonc is also recognized', async () => {
      const root = await makeTmp()
      await makeFakeRepos(root)
      await writeProject({
        dir: join(root, 'jsonc-proj'),
        manifest: { devDependencies: { lintmax: 'latest' }, name: 'jsonc-proj' },
        turbo: { content: '{}', name: 'turbo.jsonc' }
      })
      const result = await discover(root)
      expect(result.consumers.some(c => c.name === 'jsonc-proj')).toBe(true)
      await rm(root, { recursive: true })
    })
    test('lintmax in dependencies (not devDeps) is still discovered', async () => {
      const root = await makeTmp()
      await makeFakeRepos(root)
      await writeProject({
        dir: join(root, 'uses-lintmax'),
        manifest: { dependencies: { lintmax: 'latest' }, name: 'uses-lintmax' },
        turbo: plainTurbo
      })
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
})
describe('discoverSources', () => {
  test('finds self and cnsync from repos dir', async () => {
    const root = await makeTmp()
    const { cnsyncDir, selfDir } = await writeSourceRepos(root, false)
    const result = await discoverSources(root)
    expect(result.self).toBeDefined()
    expect(result.cnsync).toBeDefined()
    expect(result.self.path).toBe(selfDir)
    expect(result.cnsync.path).toBe(cnsyncDir)
    await rm(root, { recursive: true })
  })
  test('self is marked isSelf true', async () => {
    const root = await makeTmp()
    await writeSourceRepos(root, false)
    const result = await discoverSources(root)
    expect(result.self.isSelf).toBe(true)
    expect(result.cnsync.isCnsync).toBe(true)
    await rm(root, { recursive: true })
  })
  test('falls back to clone path when repos not found', async () => {
    const root = await makeTmp()
    const reposDir = join(root, '.pm4ai', 'repos')
    const cloneSrc = await makeBareClones()
    process.env.PM4AI_CLONE_BASE = cloneSrc
    try {
      const result = await discoverSources(root)
      expect(result.self.path).toBe(join(reposDir, 'pm4ai'))
      expect(result.cnsync.path).toBe(join(reposDir, 'cnsync'))
    } finally {
      await removeCloneFixture(root, cloneSrc)
    }
  })
})
