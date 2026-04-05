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
})
