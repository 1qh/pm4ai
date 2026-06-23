import { $, write } from 'bun'
import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { list } from '../list.js'

const makeTmp = async () => mkdtemp(join(tmpdir(), 'pm4ai-list-'))
const initGitRepo = async (dir: string) => {
  await $`git init`.cwd(dir).quiet().nothrow()
}
const makeProject = async (root: string, name: string) => {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await initGitRepo(dir)
  await write(join(dir, 'turbo.json'), '{}')
  await write(join(dir, 'package.json'), JSON.stringify({ devDependencies: { lintmax: 'latest' }, name }))
  return dir
}
describe('list', () => {
  test('excludes projects by path', async () => {
    const root = await makeTmp()
    const projectA = await makeProject(root, 'project-a')
    const projectB = await makeProject(root, 'project-b')
    const rows: string[] = []
    try {
      await list([projectB], root, row => rows.push(row))
    } finally {
      await rm(root, { recursive: true })
    }
    expect(rows.some(row => row.includes(projectA))).toBe(true)
    expect(rows.every(row => !row.includes(projectB))).toBe(true)
  }, 15_000)
})
