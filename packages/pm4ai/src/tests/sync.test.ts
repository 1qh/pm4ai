import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncConfigs, syncPackageJson, syncSubPackages, syncTsconfig } from '../sync.js'
const makeTmp = () => mkdtempSync(join(tmpdir(), 'pm4ai-test-'))
describe('syncConfigs', () => {
  test('copies verbatim files from source to dest', async () => {
    const src = makeTmp()
    const dst = makeTmp()
    writeFileSync(join(src, 'clean.sh'), '#!/bin/sh\nrm -rf dist')
    writeFileSync(join(src, 'up.sh'), '#!/bin/sh\nbun i')
    const issues = await syncConfigs(src, dst)
    expect(issues.length).toBeGreaterThan(0)
    expect(existsSync(join(dst, 'clean.sh'))).toBe(true)
    expect(readFileSync(join(dst, 'clean.sh'), 'utf8')).toBe('#!/bin/sh\nrm -rf dist')
    rmSync(src, { recursive: true })
    rmSync(dst, { recursive: true })
  })
  test('no issues when files already match', async () => {
    const src = makeTmp()
    const dst = makeTmp()
    writeFileSync(join(src, 'clean.sh'), 'content')
    writeFileSync(join(dst, 'clean.sh'), 'content')
    const issues = await syncConfigs(src, dst)
    const cleanIssue = issues.find(i => i.detail.includes('clean.sh'))
    expect(cleanIssue).toBeUndefined()
    rmSync(src, { recursive: true })
    rmSync(dst, { recursive: true })
  })
})
describe('syncPackageJson', () => {
  test('adds sherif and hooks to minimal package.json', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    const issues = await syncPackageJson(tmp)
    const details = issues.map(i => i.detail)
    expect(details).toContain('added sherif to postinstall')
    expect(details).toContain('added simple-git-hooks')
    expect(details).toContain('added prepare script')
    const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8')) as Record<string, Record<string, string>>
    expect(pkg.scripts?.postinstall).toContain('sherif')
    expect(pkg.scripts?.prepare).toBe('bunx simple-git-hooks')
    expect(pkg['simple-git-hooks']).toBeDefined()
    expect(pkg.devDependencies?.sherif).toBe('latest')
    rmSync(tmp, { recursive: true })
  })
  test('adds lintmax to trustedDependencies', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    const issues = await syncPackageJson(tmp)
    expect(issues.some(i => i.detail.includes('trustedDependencies'))).toBe(true)
    const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8')) as Record<string, unknown>
    expect(pkg.trustedDependencies).toEqual(['lintmax'])
    rmSync(tmp, { recursive: true })
  })
  test('preserves existing trustedDependencies', async () => {
    const tmp = makeTmp()
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ name: 'test', private: true, trustedDependencies: ['esbuild'] })
    )
    const issues = await syncPackageJson(tmp)
    expect(issues.some(i => i.detail.includes('trustedDependencies'))).toBe(true)
    const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8')) as Record<string, unknown>
    expect(pkg.trustedDependencies).toEqual(['esbuild', 'lintmax'])
    rmSync(tmp, { recursive: true })
  })
  test('no-op when lintmax already trusted', async () => {
    const tmp = makeTmp()
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({
        devDependencies: { sherif: 'latest', 'simple-git-hooks': 'latest' },
        name: 'test',
        private: true,
        scripts: { clean: 'sh clean.sh', postinstall: 'sherif', prepare: 'bunx simple-git-hooks' },
        'simple-git-hooks': { 'pre-commit': 'sh up.sh && git add -u' },
        trustedDependencies: ['lintmax']
      })
    )
    const issues = await syncPackageJson(tmp)
    expect(issues.filter(i => i.detail.includes('trustedDependencies'))).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
  test('adds required root devDeps', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    await syncPackageJson(tmp)
    const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8')) as Record<string, Record<string, string>>
    expect(pkg.devDependencies?.turbo).toBe('latest')
    expect(pkg.devDependencies?.typescript).toBe('latest')
    expect(pkg.devDependencies?.['@types/bun']).toBe('latest')
    expect(pkg.devDependencies?.lintmax).toBe('latest')
    rmSync(tmp, { recursive: true })
  })
  test('adds build/check/fix scripts', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    await syncPackageJson(tmp)
    const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8')) as Record<string, Record<string, string>>
    expect(pkg.scripts?.build).toContain('turbo')
    expect(pkg.scripts?.check).toBe('lintmax check')
    expect(pkg.scripts?.fix).toBe('lintmax fix')
    rmSync(tmp, { recursive: true })
  })
  test('does not overwrite existing build/check/fix scripts', async () => {
    const tmp = makeTmp()
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({
        name: 'test',
        private: true,
        scripts: { build: 'custom build', check: 'custom check', fix: 'custom fix' }
      })
    )
    await syncPackageJson(tmp)
    const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8')) as Record<string, Record<string, string>>
    expect(pkg.scripts?.build).toBe('custom build')
    expect(pkg.scripts?.check).toBe('custom check')
    expect(pkg.scripts?.fix).toBe('custom fix')
    rmSync(tmp, { recursive: true })
  })
  test('adds packageManager if missing', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    await syncPackageJson(tmp)
    const pkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8')) as Record<string, string>
    expect(pkg.packageManager?.startsWith('bun@')).toBe(true)
    rmSync(tmp, { recursive: true })
  })
})
describe('syncSubPackages', () => {
  const selfPath = join(import.meta.dirname, '..', '..')
  const makeProject = (rootPkg: Record<string, unknown>, subPkgs: Record<string, Record<string, unknown>>) => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'package.json'), JSON.stringify(rootPkg))
    for (const [rel, pkg] of Object.entries(subPkgs)) {
      const dir = join(tmp, rel.replace('/package.json', ''))
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(tmp, rel), JSON.stringify(pkg))
    }
    return tmp
  }
  test('sets apps to private', async () => {
    const tmp = makeProject({ private: true, workspaces: ['apps/*'] }, { 'apps/web/package.json': { name: '@a/web' } })
    const issues = await syncSubPackages(selfPath, tmp)
    expect(issues.some(i => i.detail.includes('private'))).toBe(true)
    const pkg = JSON.parse(readFileSync(join(tmp, 'apps/web/package.json'), 'utf8')) as Record<string, unknown>
    expect(pkg.private).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('replaces git clean with rm -rf', async () => {
    const tmp = makeProject(
      { private: true, workspaces: ['apps/*'] },
      {
        'apps/web/package.json': { name: '@a/web', private: true, scripts: { clean: 'git clean -xdf .next node_modules' } }
      }
    )
    const issues = await syncSubPackages(selfPath, tmp)
    expect(issues.some(i => i.detail.includes('git clean'))).toBe(true)
    const pkg = JSON.parse(readFileSync(join(tmp, 'apps/web/package.json'), 'utf8')) as Record<
      string,
      Record<string, string>
    >
    expect(pkg.scripts?.clean).toContain('rm -rf')
    expect(pkg.scripts?.clean).not.toContain('git clean')
    rmSync(tmp, { recursive: true })
  })
  test('adds postpublish to published packages', async () => {
    const tmp = makeProject(
      { private: true, workspaces: ['packages/*'] },
      { 'packages/lib/package.json': { bin: './cli.js', name: 'my-lib' } }
    )
    const issues = await syncSubPackages(selfPath, tmp)
    expect(issues.some(i => i.detail.includes('postpublish'))).toBe(true)
    const pkg = JSON.parse(readFileSync(join(tmp, 'packages/lib/package.json'), 'utf8')) as Record<
      string,
      Record<string, string>
    >
    expect(pkg.scripts?.postpublish).toBe('bun run cleanup-old-versions')
    expect(existsSync(join(tmp, 'packages/lib/script/cleanup-old-versions.ts'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('sets type module and license on published packages', async () => {
    const tmp = makeProject(
      { private: true, workspaces: ['packages/*'] },
      { 'packages/lib/package.json': { bin: './cli.js', name: 'my-lib' } }
    )
    await syncSubPackages(selfPath, tmp)
    const pkg = JSON.parse(readFileSync(join(tmp, 'packages/lib/package.json'), 'utf8')) as Record<string, string>
    expect(pkg.type).toBe('module')
    expect(pkg.license).toBe('MIT')
    rmSync(tmp, { recursive: true })
  })
  test('hoists sub-package devDeps to root', async () => {
    const tmp = makeProject(
      { devDependencies: {}, private: true, workspaces: ['apps/*'] },
      { 'apps/web/package.json': { devDependencies: { '@types/react': 'latest' }, name: '@a/web', private: true } }
    )
    await syncSubPackages(selfPath, tmp)
    const rootPkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8')) as Record<string, Record<string, string>>
    expect(rootPkg.devDependencies?.['@types/react']).toBe('latest')
    const subPkg = JSON.parse(readFileSync(join(tmp, 'apps/web/package.json'), 'utf8')) as Record<string, unknown>
    expect(subPkg.devDependencies).toBeUndefined()
    rmSync(tmp, { recursive: true })
  })
  test('idempotent — second run produces no issues', async () => {
    const tmp = makeProject(
      { private: true, workspaces: ['apps/*'] },
      { 'apps/web/package.json': { name: '@a/web', private: true } }
    )
    await syncSubPackages(selfPath, tmp)
    const issues = await syncSubPackages(selfPath, tmp)
    expect(issues).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
  test('does not add empty devDependencies to packages without them', async () => {
    const tmp = makeProject(
      { private: true, workspaces: ['packages/*'] },
      { 'packages/lib/package.json': { dependencies: { zod: 'latest' }, name: '@a/lib', private: true } }
    )
    await syncSubPackages(selfPath, tmp)
    const pkg = JSON.parse(readFileSync(join(tmp, 'packages/lib/package.json'), 'utf8')) as Record<string, unknown>
    expect(pkg.devDependencies).toBeUndefined()
    rmSync(tmp, { recursive: true })
  })
})
describe('syncTsconfig', () => {
  test('removes include from root tsconfig', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'tsconfig.json'), JSON.stringify({ extends: 'lintmax/tsconfig', include: ['*.ts'] }))
    const issues = await syncTsconfig(tmp)
    expect(issues.some(i => i.detail.includes('removed'))).toBe(true)
    const tsconfig = JSON.parse(readFileSync(join(tmp, 'tsconfig.json'), 'utf8')) as Record<string, unknown>
    expect(tsconfig.include).toBeUndefined()
    expect(tsconfig.extends).toBe('lintmax/tsconfig')
    rmSync(tmp, { recursive: true })
  })
  test('no-op when tsconfig has no include', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'tsconfig.json'), JSON.stringify({ extends: 'lintmax/tsconfig' }))
    const issues = await syncTsconfig(tmp)
    expect(issues).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
  test('no-op when tsconfig does not exist', async () => {
    const tmp = makeTmp()
    const issues = await syncTsconfig(tmp)
    expect(issues).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
  test('preserves other tsconfig fields', async () => {
    const tmp = makeTmp()
    writeFileSync(
      join(tmp, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { types: ['bun-types'] },
        extends: 'lintmax/tsconfig',
        include: ['*.ts']
      })
    )
    await syncTsconfig(tmp)
    const tsconfig = JSON.parse(readFileSync(join(tmp, 'tsconfig.json'), 'utf8')) as Record<string, unknown>
    expect(tsconfig.extends).toBe('lintmax/tsconfig')
    expect(tsconfig.compilerOptions).toBeDefined()
    expect(tsconfig.include).toBeUndefined()
    rmSync(tmp, { recursive: true })
  })
})
