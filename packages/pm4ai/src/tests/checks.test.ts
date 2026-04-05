import { describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkConfigs, checkForbidden, checkGit, checkLint, checkRootPkg } from '../checks.js'
const makeTmp = () => mkdtempSync(join(tmpdir(), 'pm4ai-test-'))
describe('checkRootPkg', () => {
  test('reports missing fields for minimal package.json', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test' }))
    const issues = await checkRootPkg(tmp)
    const details = issues.map(i => i.detail)
    expect(details).toContain('root package.json should be private')
    expect(details).toContain('packageManager field missing')
    expect(details).toContain('simple-git-hooks in package.json')
    rmSync(tmp, { recursive: true })
  })
  test('no issues for well-configured package.json', async () => {
    const tmp = makeTmp()
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({
        packageManager: 'bun@1.2.0',
        private: true,
        scripts: {
          clean: 'sh clean.sh',
          postinstall: 'sherif',
          prepare: 'bunx simple-git-hooks'
        },
        'simple-git-hooks': { 'pre-commit': 'sh up.sh && git add -u' }
      })
    )
    const issues = await checkRootPkg(tmp)
    expect(issues).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
})
describe('checkConfigs', () => {
  test('reports missing turbo.json and tsconfig.json', async () => {
    const tmp = makeTmp()
    const issues = await checkConfigs(tmp)
    const details = issues.map(i => i.detail)
    expect(details).toContain('turbo.json')
    expect(details).toContain('tsconfig.json')
    rmSync(tmp, { recursive: true })
  })
})
describe('checkForbidden', () => {
  test('flags package-lock.json', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'package-lock.json'), '{}')
    const issues = await checkForbidden(tmp)
    const details = issues.map(i => i.detail)
    expect(details.some(d => d.includes('package-lock.json'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('flags yarn.lock', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'yarn.lock'), '')
    const issues = await checkForbidden(tmp)
    const details = issues.map(i => i.detail)
    expect(details.some(d => d.includes('yarn.lock'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('flags nested .gitignore', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, '.gitignore'), 'node_modules')
    mkdirSync(join(tmp, '.git'))
    mkdirSync(join(tmp, 'apps'))
    writeFileSync(join(tmp, 'apps', '.gitignore'), 'dist')
    const issues = await checkForbidden(tmp)
    expect(issues.some(i => i.detail.includes('nested .gitignore'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('no issue when only root .gitignore', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, '.gitignore'), 'node_modules')
    const issues = await checkForbidden(tmp)
    expect(issues.filter(i => i.detail.includes('nested .gitignore'))).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
  test('flags postcss.config.mjs', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'apps', 'web'), { recursive: true })
    writeFileSync(join(tmp, 'apps', 'web', 'postcss.config.mjs'), 'export default {}')
    const issues = await checkForbidden(tmp)
    expect(issues.some(i => i.detail.includes('postcss.config.mjs'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
})
describe('checkConfigs tsconfig', () => {
  test('flags tsconfig with include', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'turbo.json'), '{}')
    writeFileSync(join(tmp, 'tsconfig.json'), JSON.stringify({ extends: 'lintmax/tsconfig', include: ['*.ts'] }))
    const issues = await checkConfigs(tmp)
    expect(issues.some(i => i.detail.includes('should not have "include"'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('no include flag when tsconfig has no include', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'turbo.json'), '{}')
    writeFileSync(join(tmp, 'tsconfig.json'), JSON.stringify({ extends: 'lintmax/tsconfig' }))
    const issues = await checkConfigs(tmp)
    expect(issues.filter(i => i.detail.includes('include'))).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
})
describe('checkGit', () => {
  const makeGitRepo = () => {
    const tmp = makeTmp()
    execSync('git init', { cwd: tmp, stdio: 'pipe' })
    execSync('git -c user.name=test -c user.email=test@test commit --allow-empty -m init', { cwd: tmp, stdio: 'pipe' })
    return tmp
  }
  test('clean repo reports no git issues', async () => {
    const tmp = makeGitRepo()
    const issues = await checkGit(tmp)
    const gitIssues = issues.filter(i => i.type === 'git')
    expect(gitIssues).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
  test('dirty repo reports uncommitted changes', async () => {
    const tmp = makeGitRepo()
    writeFileSync(join(tmp, 'dirty.txt'), 'dirty')
    const issues = await checkGit(tmp)
    expect(issues.some(i => i.type === 'git' && i.detail.includes('uncommitted'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
})
describe('checkLint', () => {
  test('returns never run when no check cache', () => {
    const tmp = makeTmp()
    const issues = checkLint(tmp)
    expect(issues.some(i => i.detail.includes('never run'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
})
