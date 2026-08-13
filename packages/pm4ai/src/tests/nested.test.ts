import { $, write } from 'bun'
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getCodeCommitsSince, getHeadCommit } from '../check-cache.js'
import { checkGit } from '../checks.js'
import { repoGitState } from '../fix.js'
import { list } from '../list.js'
import { isNestedProject } from '../utils.js'

setDefaultTimeout(30_000)
const makeTmp = async () => mkdtemp(join(tmpdir(), 'pm4ai-nested-'))
const commitAll = async (dir: string, message: string) => {
  await $`git add -A`.cwd(dir).quiet().nothrow()
  await $`git -c user.name=t -c user.email=t@t commit -m ${message}`.cwd(dir).quiet().nothrow()
}
/** A repo holding a managed project at `proj/` and an unrelated sibling directory at `other/`, which is the whole
 * shape under test: every git answer about `proj` must exclude what happens in `other`. */
const makeNestedRepo = async (): Promise<{ project: string; repo: string; root: string }> => {
  const root = await makeTmp()
  const repo = join(root, 'repo')
  const project = join(repo, 'proj')
  await mkdir(project, { recursive: true })
  await mkdir(join(repo, 'other'), { recursive: true })
  await $`git init -b main`.cwd(repo).quiet().nothrow()
  await write(join(repo, 'other', 'a.txt'), 'a\n')
  await write(join(project, 'turbo.json'), '{}')
  await write(join(project, 'package.json'), JSON.stringify({ devDependencies: { lintmax: 'latest' }, name: 'proj' }))
  await commitAll(repo, 'init')
  return { project, repo, root }
}
describe('isNestedProject', () => {
  test('a repo root is not nested', async () => {
    const { repo, root } = await makeNestedRepo()
    try {
      expect(await isNestedProject(repo)).toBe(false)
    } finally {
      await rm(root, { recursive: true })
    }
  })
  test('a folder inside a repo is nested', async () => {
    const { project, root } = await makeNestedRepo()
    try {
      expect(await isNestedProject(project)).toBe(true)
    } finally {
      await rm(root, { recursive: true })
    }
  })
  test('a directory in no repo at all is not nested', async () => {
    const root = await makeTmp()
    try {
      expect(await isNestedProject(root)).toBe(false)
    } finally {
      await rm(root, { recursive: true })
    }
  })
})
describe('checkGit on a nested project', () => {
  test('a sibling directory dirty in the parent repo is not the project uncommitted', async () => {
    const { project, repo, root } = await makeNestedRepo()
    try {
      await write(join(repo, 'other', 'b.txt'), 'b\n')
      expect(await checkGit(project)).toEqual([])
    } finally {
      await rm(root, { recursive: true })
    }
  })
  test('the project own uncommitted change is still reported', async () => {
    const { project, root } = await makeNestedRepo()
    try {
      await write(join(project, 'c.txt'), 'c\n')
      const issues = await checkGit(project)
      expect(issues).toHaveLength(1)
      expect(issues[0]?.detail).toContain('1 uncommitted')
    } finally {
      await rm(root, { recursive: true })
    }
  })
})
describe('repoGitState on a nested project', () => {
  test('reports settled without pulling the parent repo behind its upstream', async () => {
    const { project, repo, root } = await makeNestedRepo()
    const remote = join(root, 'remote.git')
    try {
      await $`git init --bare -b main ${remote}`.quiet().nothrow()
      await $`git remote add origin ${remote}`.cwd(repo).quiet().nothrow()
      await $`git push -u origin main`.cwd(repo).quiet().nothrow()
      const clone = join(root, 'clone')
      await $`git clone ${remote} ${clone}`.quiet().nothrow()
      await write(join(clone, 'd.txt'), 'd\n')
      await commitAll(clone, 'ahead')
      await $`git push`.cwd(clone).quiet().nothrow()
      const state = await repoGitState(project)
      expect(state).toEqual({ behind: 0, name: 'proj', path: project })
      const local = await $`git rev-list --count HEAD`.cwd(repo).quiet().nothrow()
      expect(local.stdout.toString().trim()).toBe('1')
    } finally {
      await rm(root, { recursive: true })
    }
  })
})
describe('list on a nested project', () => {
  test('reads clean while a sibling directory in the parent repo is dirty', async () => {
    const { project, repo, root } = await makeNestedRepo()
    const rows: string[] = []
    try {
      await write(join(repo, 'other', 'b.txt'), 'b\n')
      await list([], root, row => rows.push(row))
      expect(rows.some(r => r.startsWith(`${project}\t`) && r.includes('clean'))).toBe(true)
    } finally {
      await rm(root, { recursive: true })
    }
  })
})
describe('getCodeCommitsSince on a nested project', () => {
  test('counts only commits touching the project', async () => {
    const { project, repo, root } = await makeNestedRepo()
    try {
      const base = await getHeadCommit(project)
      await write(join(repo, 'other', 'b.txt'), 'b\n')
      await commitAll(repo, 'sibling only')
      expect(await getCodeCommitsSince(project, base)).toBe(0)
      await write(join(project, 'c.ts'), 'export const c = 1\n')
      await commitAll(repo, 'project change')
      expect(await getCodeCommitsSince(project, base)).toBe(1)
    } finally {
      await rm(root, { recursive: true })
    }
  })
})
