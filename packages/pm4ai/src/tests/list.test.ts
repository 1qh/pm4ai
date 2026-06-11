import { describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { list } from '../list.js'

const makeTmp = () => mkdtempSync(join(tmpdir(), 'pm4ai-list-'))
const initGitRepo = (dir: string) => {
  execSync('git init', { cwd: dir, stdio: 'pipe' })
}
const makeProject = (root: string, name: string) => {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  initGitRepo(dir)
  writeFileSync(join(dir, 'turbo.json'), '{}')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { lintmax: 'latest' }, name }))
  return dir
}
describe('list', () => {
  test('excludes projects by path', async () => {
    const root = makeTmp()
    const projectA = makeProject(root, 'project-a')
    const projectB = makeProject(root, 'project-b')
    const rows: string[] = []
    try {
      await list([projectB], root, row => rows.push(row))
    } finally {
      rmSync(root, { recursive: true })
    }
    expect(rows.some(row => row.includes(projectA))).toBe(true)
    expect(rows.every(row => !row.includes(projectB))).toBe(true)
  }, 15_000)
})
