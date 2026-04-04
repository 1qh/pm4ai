import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkConfigs, checkForbidden, checkRootPkg } from '../checks.js'
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
    expect(details).toContain('.github/workflows/ci.yml')
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
})
