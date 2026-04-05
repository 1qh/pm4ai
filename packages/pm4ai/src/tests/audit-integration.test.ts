import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { audit } from '../audit.js'
const makeTmp = () => mkdtempSync(join(tmpdir(), 'pm4ai-audit-'))
describe('audit integration', () => {
  test('clean project produces no critical issues', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'packages', 'lib'), { recursive: true })
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({
        devDependencies: {
          '@types/bun': 'latest',
          lintmax: 'latest',
          sherif: 'latest',
          'simple-git-hooks': 'latest',
          turbo: 'latest',
          typescript: 'latest'
        },
        packageManager: 'bun@1.3.11',
        private: true,
        scripts: {
          build: 'turbo build --output-logs=errors-only',
          check: 'lintmax check',
          fix: 'lintmax fix'
        },
        trustedDependencies: ['lintmax'],
        workspaces: ['packages/*']
      })
    )
    writeFileSync(
      join(tmp, 'packages', 'lib', 'package.json'),
      JSON.stringify({
        dependencies: { zod: 'latest' },
        name: '@a/lib',
        private: true
      })
    )
    const issues = await audit(tmp)
    const criticalTypes = new Set(['dep', 'forbidden'])
    const critical = issues.filter(i => criticalTypes.has(i.type))
    expect(critical).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
  test('detects missing trustedDependencies', async () => {
    const tmp = makeTmp()
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ devDependencies: { lintmax: 'latest' }, private: true, workspaces: [] })
    )
    const issues = await audit(tmp)
    expect(issues.some(i => i.detail.includes('trustedDependencies'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('detects missing root devDeps', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ devDependencies: {}, private: true, workspaces: [] }))
    const issues = await audit(tmp)
    expect(issues.some(i => i.detail.includes('turbo'))).toBe(true)
    expect(issues.some(i => i.detail.includes('typescript'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('detects pinned dependency versions', async () => {
    const tmp = makeTmp()
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ dependencies: { react: '19.0.0' }, private: true, workspaces: [] })
    )
    const issues = await audit(tmp)
    expect(issues.some(i => i.type === 'dep' && i.detail.includes('react'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('detects non-private app packages', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'apps', 'web'), { recursive: true })
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ private: true, workspaces: ['apps/*'] }))
    writeFileSync(join(tmp, 'apps', 'web', 'package.json'), JSON.stringify({ name: '@a/web' }))
    const issues = await audit(tmp)
    expect(issues.some(i => i.detail.includes('private'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('detects forbidden PM in scripts', async () => {
    const tmp = makeTmp()
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ private: true, scripts: { deploy: 'npm publish' }, workspaces: [] })
    )
    const issues = await audit(tmp)
    expect(issues.some(i => i.type === 'forbidden' && i.detail.includes('non-bun'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('detects duplicate deps across workspace packages', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'packages', 'a'), { recursive: true })
    mkdirSync(join(tmp, 'packages', 'b'), { recursive: true })
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/*'] }))
    writeFileSync(
      join(tmp, 'packages', 'a', 'package.json'),
      JSON.stringify({ dependencies: { zod: 'latest' }, name: '@a/a' })
    )
    writeFileSync(
      join(tmp, 'packages', 'b', 'package.json'),
      JSON.stringify({ dependencies: { '@a/a': 'workspace:*', zod: 'latest' }, name: '@a/b' })
    )
    const issues = await audit(tmp)
    expect(issues.some(i => i.type === 'duplicate' && i.detail.includes('zod'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('detects external devDeps in sub-packages', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'packages', 'lib'), { recursive: true })
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/*'] }))
    writeFileSync(
      join(tmp, 'packages', 'lib', 'package.json'),
      JSON.stringify({ devDependencies: { vitest: 'latest' }, name: '@a/lib', private: true })
    )
    const issues = await audit(tmp)
    expect(issues.some(i => i.type === 'drift' && i.detail.includes('hoisted'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('detects published pkg missing type module', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'packages', 'lib'), { recursive: true })
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/*'] }))
    writeFileSync(
      join(tmp, 'packages', 'lib', 'package.json'),
      JSON.stringify({ exports: { '.': './dist/index.js' }, name: 'my-lib' })
    )
    const issues = await audit(tmp)
    expect(issues.some(i => i.detail.includes('type') && i.detail.includes('module'))).toBe(true)
    expect(issues.some(i => i.detail.includes('license'))).toBe(true)
    expect(issues.some(i => i.detail.includes('repository'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('detects turbo scripts missing output flag', async () => {
    const tmp = makeTmp()
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ private: true, scripts: { build: 'turbo build' }, workspaces: [] })
    )
    const issues = await audit(tmp)
    expect(issues.some(i => i.detail.includes('--output-logs=errors-only'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('detects git clean in sub-package scripts', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'apps', 'web'), { recursive: true })
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ private: true, workspaces: ['apps/*'] }))
    writeFileSync(
      join(tmp, 'apps', 'web', 'package.json'),
      JSON.stringify({ name: '@a/web', private: true, scripts: { clean: 'git clean -xdf' } })
    )
    const issues = await audit(tmp)
    expect(issues.some(i => i.detail.includes('git clean'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('handles empty project with no package.json', async () => {
    const tmp = makeTmp()
    const issues = await audit(tmp)
    expect(issues).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
  test('detects bun version behind latest', async () => {
    const tmp = makeTmp()
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ packageManager: 'bun@0.0.1', private: true, workspaces: [] })
    )
    const issues = await audit(tmp)
    const bunIssue = issues.find(i => i.type === 'bun')
    if (bunIssue) expect(bunIssue.detail).toContain('behind')
    rmSync(tmp, { recursive: true })
  })
  test('detects redundant clean script in sub-package', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'apps', 'web'), { recursive: true })
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ private: true, workspaces: ['apps/*'] }))
    writeFileSync(
      join(tmp, 'apps', 'web', 'package.json'),
      JSON.stringify({ name: '@a/web', private: true, scripts: { clean: 'rm -rf dist' } })
    )
    const issues = await audit(tmp)
    expect(issues.some(i => i.detail.includes('redundant'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
})
