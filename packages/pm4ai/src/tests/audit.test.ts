import { describe, expect, test } from 'bun:test'
import type { PkgEntry } from '../audit.js'
import { checkDuplicates, checkNotLatest, checkPackageConventions, checkScripts, usesForbidden } from '../audit.js'
const PROJECT = '/tmp/project'
const entry = (path: string, pkg: PkgEntry['pkg']): PkgEntry => ({ path: `${PROJECT}/${path}`, pkg })
describe('usesForbidden', () => {
  test('npm publish is forbidden', () => {
    expect(usesForbidden('npm publish')).toBe(true)
  })
  test('bun publish is allowed', () => {
    expect(usesForbidden('bun publish')).toBe(false)
  })
  test('forbidden after &&', () => {
    expect(usesForbidden('lintmax fix && npm run build')).toBe(true)
  })
})
describe('checkNotLatest', () => {
  test('caret version is not flagged', () => {
    const pkgs = [entry('packages/a/package.json', { dependencies: { react: '^19' } })]
    const issues = checkNotLatest(pkgs, PROJECT)
    expect(issues).toHaveLength(0)
  })
  test('pinned version is flagged', () => {
    const pkgs = [entry('packages/a/package.json', { dependencies: { react: '19.0.0' } })]
    const issues = checkNotLatest(pkgs, PROJECT)
    expect(issues).toHaveLength(1)
    expect(issues[0].detail).toContain('react')
  })
  test('workspace: version is not flagged', () => {
    const pkgs = [entry('packages/a/package.json', { dependencies: { utils: 'workspace:*' } })]
    const issues = checkNotLatest(pkgs, PROJECT)
    expect(issues).toHaveLength(0)
  })
  test('"latest" is not flagged', () => {
    const pkgs = [entry('packages/a/package.json', { dependencies: { react: 'latest' } })]
    const issues = checkNotLatest(pkgs, PROJECT)
    expect(issues).toHaveLength(0)
  })
})
describe('checkDuplicates', () => {
  test('child redeclaring parent dep is flagged', () => {
    const parent = entry('packages/shared/package.json', {
      dependencies: { zod: '^3' },
      name: 'shared'
    })
    const child = entry('packages/app/package.json', {
      dependencies: { shared: 'workspace:*', zod: '^3' }
    })
    const issues = checkDuplicates([parent, child], PROJECT)
    expect(issues.some(i => i.detail.includes('zod'))).toBe(true)
  })
  test('no duplicate when deps are different', () => {
    const parent = entry('packages/shared/package.json', {
      dependencies: { zod: '^3' },
      name: 'shared'
    })
    const child = entry('packages/app/package.json', {
      dependencies: { react: '^19', shared: 'workspace:*' }
    })
    const issues = checkDuplicates([parent, child], PROJECT)
    expect(issues).toHaveLength(0)
  })
})
describe('checkPackageConventions', () => {
  test('published package missing files field is flagged', () => {
    const pkgs = [
      entry('package.json', { private: true }),
      entry('packages/lib/package.json', {
        exports: { '.': './dist/index.js' },
        license: 'MIT',
        name: 'lib',
        repository: 'gh',
        type: 'module'
      })
    ]
    const issues = checkPackageConventions(pkgs, PROJECT)
    expect(issues.some(i => i.detail.includes('missing "files" field'))).toBe(true)
  })
  test('private package is not checked for publish fields', () => {
    const pkgs = [entry('package.json', { private: true }), entry('packages/lib/package.json', { private: true })]
    const issues = checkPackageConventions(pkgs, PROJECT)
    expect(issues.filter(i => i.detail.includes('files'))).toHaveLength(0)
  })
})
describe('checkScripts', () => {
  test('turbo without output-logs flag is flagged', () => {
    const pkgs = [entry('package.json', { scripts: { build: 'turbo run build' } })]
    const issues = checkScripts(pkgs, PROJECT)
    expect(issues.some(i => i.detail.includes('--output-logs=errors-only'))).toBe(true)
  })
  test('turbo with flag is not flagged', () => {
    const pkgs = [entry('package.json', { scripts: { build: 'turbo run build --output-logs=errors-only' } })]
    const issues = checkScripts(pkgs, PROJECT)
    expect(issues.filter(i => i.detail.includes('--output-logs'))).toHaveLength(0)
  })
  test('dev script with turbo is not flagged', () => {
    const pkgs = [entry('package.json', { scripts: { dev: 'turbo run dev' } })]
    const issues = checkScripts(pkgs, PROJECT)
    expect(issues.filter(i => i.detail.includes('--output-logs'))).toHaveLength(0)
  })
  test('non-bun pm in script is flagged', () => {
    const pkgs = [entry('package.json', { scripts: { deploy: 'npm publish' } })]
    const issues = checkScripts(pkgs, PROJECT)
    expect(issues.some(i => i.detail.includes('non-bun pm'))).toBe(true)
  })
})
