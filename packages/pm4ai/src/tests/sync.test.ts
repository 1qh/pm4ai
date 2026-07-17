import { file, write } from 'bun'
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkClaudeMdFresh,
  serializeTsdownConfig,
  syncClaudeMd,
  syncConfigs,
  syncPackageJson,
  syncSubPackages,
  syncTsconfig,
  syncUi
} from '../sync.js'

setDefaultTimeout(30_000)
const makeTmp = async () => mkdtemp(join(tmpdir(), 'pm4ai-test-'))
const makeProject = async (rootPkg: Record<string, unknown>, subPkgs: Record<string, Record<string, unknown>>) => {
  const tmp = await makeTmp()
  await write(join(tmp, 'package.json'), JSON.stringify(rootPkg))
  for (const [rel, pkg] of Object.entries(subPkgs)) {
    const dir = join(tmp, rel.replace('/package.json', ''))
    await mkdir(dir, { recursive: true })
    await write(join(tmp, rel), JSON.stringify(pkg))
  }
  return tmp
}
const pm4aiRoot = join(import.meta.dirname, '..', '..', '..', '..')
describe('syncConfigs', () => {
  test('copies verbatim files from source to dest', async () => {
    const src = await makeTmp()
    const dst = await makeTmp()
    await write(join(src, 'clean.sh'), '#!/bin/sh\nrm -rf dist')
    await write(join(src, 'up.sh'), '#!/bin/sh\nbun i')
    const issues = await syncConfigs(src, dst)
    expect(issues.length).toBeGreaterThan(0)
    expect(await file(join(dst, 'clean.sh')).exists()).toBe(true)
    expect(await file(join(dst, 'clean.sh')).text()).toBe('#!/bin/sh\nrm -rf dist')
    await rm(src, { recursive: true })
    await rm(dst, { recursive: true })
  })
  test('no issues when files already match', async () => {
    const src = await makeTmp()
    const dst = await makeTmp()
    await write(join(src, 'clean.sh'), 'content')
    await write(join(dst, 'clean.sh'), 'content')
    const issues = await syncConfigs(src, dst)
    const cleanIssue = issues.find(i => i.detail.includes('clean.sh'))
    expect(cleanIssue).toBeUndefined()
    await rm(src, { recursive: true })
    await rm(dst, { recursive: true })
  })
})
describe('syncPackageJson', () => {
  test('adds sherif and hooks to minimal package.json', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    const issues = await syncPackageJson(tmp, pm4aiRoot)
    const details = issues.map(i => i.detail)
    expect(details).toContain('added sherif to postinstall')
    expect(details).toContain('added simple-git-hooks')
    expect(details).toContain('added prepare script')
    const pkg = (await file(join(tmp, 'package.json')).json()) as Record<string, Record<string, string>>
    expect(pkg.scripts?.postinstall).toContain('sherif')
    expect(pkg.scripts?.prepare).toBe('bunx simple-git-hooks')
    expect(pkg['simple-git-hooks']).toBeDefined()
    expect(pkg.devDependencies?.sherif).toBe('latest')
    await rm(tmp, { recursive: true })
  })
  test('adds lintmax to trustedDependencies', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    const issues = await syncPackageJson(tmp, pm4aiRoot)
    expect(issues.some(i => i.detail.includes('trustedDependencies'))).toBe(true)
    const pkg = (await file(join(tmp, 'package.json')).json()) as Record<string, unknown>
    expect(pkg.trustedDependencies).toEqual(['esbuild', 'lintmax', 'msw', 'sharp', 'simple-git-hooks'])
    await rm(tmp, { recursive: true })
  })
  test('preserves existing trustedDependencies', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true, trustedDependencies: ['sharp'] }))
    const issues = await syncPackageJson(tmp, pm4aiRoot)
    expect(issues.some(i => i.detail.includes('trustedDependencies'))).toBe(true)
    const pkg = (await file(join(tmp, 'package.json')).json()) as Record<string, unknown>
    expect(pkg.trustedDependencies).toEqual(['esbuild', 'lintmax', 'msw', 'sharp', 'simple-git-hooks'])
    await rm(tmp, { recursive: true })
  })
  test('no-op when all required already trusted', async () => {
    const tmp = await makeTmp()
    await write(
      join(tmp, 'package.json'),
      JSON.stringify({
        devDependencies: { sherif: 'latest', 'simple-git-hooks': 'latest' },
        name: 'test',
        private: true,
        scripts: { clean: 'sh clean.sh', postinstall: 'sherif', prepare: 'bunx simple-git-hooks' },
        'simple-git-hooks': { 'pre-commit': 'sh up.sh && git add -u' },
        trustedDependencies: ['esbuild', 'lintmax', 'msw', 'sharp', 'simple-git-hooks']
      })
    )
    const issues = await syncPackageJson(tmp, pm4aiRoot)
    expect(issues.filter(i => i.detail.includes('trustedDependencies'))).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('adds required root devDeps', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    await syncPackageJson(tmp, pm4aiRoot)
    const pkg = (await file(join(tmp, 'package.json')).json()) as Record<string, Record<string, string>>
    expect(pkg.devDependencies?.turbo).toBe('latest')
    expect(pkg.devDependencies?.typescript).toBe('latest')
    expect(pkg.devDependencies?.lintmax).toBe('latest')
    await rm(tmp, { recursive: true })
  })
  test('adds build/check/fix scripts', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    await syncPackageJson(tmp, pm4aiRoot)
    const pkg = (await file(join(tmp, 'package.json')).json()) as Record<string, Record<string, string>>
    expect(pkg.scripts?.build).toContain('turbo')
    expect(pkg.scripts?.check).toBe('lintmax check')
    expect(pkg.scripts?.fix).toBe('lintmax fix')
    await rm(tmp, { recursive: true })
  })
  test('adds an sh up.sh action when none exists', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    await syncPackageJson(tmp, pm4aiRoot)
    const pkg = (await file(join(tmp, 'package.json')).json()) as Record<string, Record<string, string>>
    expect(pkg.scripts?.action).toBe('sh up.sh')
    await rm(tmp, { recursive: true })
  })
  test('leaves an action that already runs sh up.sh after a pre-step untouched', async () => {
    const tmp = await makeTmp()
    const preStepAction =
      '[ -f apps/backend/.env ] || cp apps/backend/.env.example apps/backend/.env; sh up.sh && bun run test'
    await write(
      join(tmp, 'package.json'),
      JSON.stringify({ name: 'test', private: true, scripts: { action: preStepAction } })
    )
    const issues = await syncPackageJson(tmp, pm4aiRoot)
    expect(issues.some(i => i.detail.includes('action'))).toBe(false)
    const pkg = (await file(join(tmp, 'package.json')).json()) as Record<string, Record<string, string>>
    expect(pkg.scripts?.action).toBe(preStepAction)
    await rm(tmp, { recursive: true })
  })
  test('preserves a clean script that starts with the default plus a suffix', async () => {
    const tmp = await makeTmp()
    const suffixedClean = 'sh clean.sh && rm -rf .turbo'
    await write(
      join(tmp, 'package.json'),
      JSON.stringify({ name: 'test', private: true, scripts: { clean: suffixedClean } })
    )
    await syncPackageJson(tmp, pm4aiRoot)
    const pkg = (await file(join(tmp, 'package.json')).json()) as Record<string, Record<string, string>>
    expect(pkg.scripts?.clean).toBe(suffixedClean)
    await rm(tmp, { recursive: true })
  })
  test('canonicalizes existing build/check/fix scripts', async () => {
    const tmp = await makeTmp()
    await write(
      join(tmp, 'package.json'),
      JSON.stringify({
        name: 'test',
        private: true,
        scripts: { build: 'custom build', check: 'custom check', fix: 'custom fix' }
      })
    )
    await syncPackageJson(tmp, pm4aiRoot)
    const pkg = (await file(join(tmp, 'package.json')).json()) as Record<string, Record<string, string>>
    expect(pkg.scripts?.build).toContain('grep -vE')
    expect(pkg.scripts?.check).toBe('lintmax check')
    expect(pkg.scripts?.fix).toBe('lintmax fix')
    await rm(tmp, { recursive: true })
  })
  test('preserves fix preflight when lintmax fix runs last', async () => {
    const tmp = await makeTmp()
    await write(
      join(tmp, 'package.json'),
      JSON.stringify({
        name: 'test',
        private: true,
        scripts: { build: 'custom build', check: 'custom check', fix: 'bun run build && lintmax fix' }
      })
    )
    await syncPackageJson(tmp, pm4aiRoot)
    const pkg = (await file(join(tmp, 'package.json')).json()) as Record<string, Record<string, string>>
    expect(pkg.scripts?.build).toContain('grep -vE')
    expect(pkg.scripts?.check).toBe('lintmax check')
    expect(pkg.scripts?.fix).toBe('bun run build && lintmax fix')
    await rm(tmp, { recursive: true })
  })
  test('preserves self-hosted cli fix script', async () => {
    const tmp = await makeTmp()
    await write(
      join(tmp, 'package.json'),
      JSON.stringify({
        name: 'test',
        private: true,
        scripts: { fix: 'bun packages/lintmax/dist/cli.mjs fix' }
      })
    )
    await syncPackageJson(tmp, pm4aiRoot)
    const pkg = (await file(join(tmp, 'package.json')).json()) as Record<string, Record<string, string>>
    expect(pkg.scripts?.fix).toBe('bun packages/lintmax/dist/cli.mjs fix')
    await rm(tmp, { recursive: true })
  })
  test('preserves self-hosted cli check script', async () => {
    const tmp = await makeTmp()
    await write(
      join(tmp, 'package.json'),
      JSON.stringify({
        name: 'test',
        private: true,
        scripts: { check: 'bun packages/lintmax/dist/cli.mjs check' }
      })
    )
    await syncPackageJson(tmp, pm4aiRoot)
    const pkg = (await file(join(tmp, 'package.json')).json()) as Record<string, Record<string, string>>
    expect(pkg.scripts?.check).toBe('bun packages/lintmax/dist/cli.mjs check')
    await rm(tmp, { recursive: true })
  })
  test('wraps root turbo scripts with workspace warning filter', async () => {
    const tmp = await makeTmp()
    await write(
      join(tmp, 'package.json'),
      JSON.stringify({
        name: 'test',
        private: true,
        scripts: { test: 'turbo test --output-logs=errors-only' }
      })
    )
    await syncPackageJson(tmp, pm4aiRoot)
    const pkg = (await file(join(tmp, 'package.json')).json()) as Record<string, Record<string, string>>
    expect(pkg.scripts?.test).toContain('grep -vE')
    expect(pkg.scripts?.test).toContain('Could not resolve workspaces')
    await rm(tmp, { recursive: true })
  })
  test('adds packageManager if missing', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    await syncPackageJson(tmp, pm4aiRoot)
    const pkg = (await file(join(tmp, 'package.json')).json()) as Record<string, string>
    expect(pkg.packageManager?.startsWith('bun@')).toBe(true)
    await rm(tmp, { recursive: true })
  })
})
describe('syncSubPackages', () => {
  const selfPath = join(import.meta.dirname, '..', '..')
  test('sets apps to private', async () => {
    const tmp = await makeProject(
      { private: true, workspaces: ['apps/*'] },
      { 'apps/web/package.json': { name: '@a/web' } }
    )
    const issues = await syncSubPackages(selfPath, tmp)
    expect(issues.some(i => i.detail.includes('private'))).toBe(true)
    const pkg = (await file(join(tmp, 'apps/web/package.json')).json()) as Record<string, unknown>
    expect(pkg.private).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('removes redundant clean script from sub-package', async () => {
    const tmp = await makeProject(
      { private: true, workspaces: ['apps/*'] },
      {
        'apps/web/package.json': { name: '@a/web', private: true, scripts: { clean: 'git clean -xdf .next node_modules' } }
      }
    )
    const issues = await syncSubPackages(selfPath, tmp)
    expect(issues.some(i => i.detail.includes('removed redundant "clean"'))).toBe(true)
    const pkg = (await file(join(tmp, 'apps/web/package.json')).json()) as Record<string, unknown>
    expect(pkg.scripts).toBeUndefined()
    await rm(tmp, { recursive: true })
  })
  test('adds postpublish to published packages', async () => {
    const tmp = await makeProject(
      { private: true, workspaces: ['packages/*'] },
      { 'packages/lib/package.json': { bin: './cli.js', name: 'my-lib' } }
    )
    const issues = await syncSubPackages(selfPath, tmp)
    expect(issues.some(i => i.detail.includes('postpublish'))).toBe(true)
    const pkg = (await file(join(tmp, 'packages/lib/package.json')).json()) as Record<string, Record<string, string>>
    expect(pkg.scripts?.postpublish).toBe('bun ../../tools/prune-versions.ts')
    await rm(tmp, { recursive: true })
  })
  test('adds prepublishOnly to packages with build script', async () => {
    const tmp = await makeProject(
      { private: true, workspaces: ['packages/*'] },
      { 'packages/lib/package.json': { bin: './cli.js', name: 'my-lib', scripts: { build: 'tsdown' } } }
    )
    const issues = await syncSubPackages(selfPath, tmp)
    expect(issues.some(i => i.detail.includes('prepublishOnly'))).toBe(true)
    const pkg = (await file(join(tmp, 'packages/lib/package.json')).json()) as Record<string, Record<string, string>>
    expect(pkg.scripts?.prepublishOnly).toBe('bun run build')
    await rm(tmp, { recursive: true })
  })
  test('sets type module and license on published packages', async () => {
    const tmp = await makeProject(
      { private: true, workspaces: ['packages/*'] },
      { 'packages/lib/package.json': { bin: './cli.js', name: 'my-lib' } }
    )
    await syncSubPackages(selfPath, tmp)
    const pkg = (await file(join(tmp, 'packages/lib/package.json')).json()) as Record<string, string>
    expect(pkg.type).toBe('module')
    expect(pkg.license).toBe('MIT')
    await rm(tmp, { recursive: true })
  })
  test('hoists sub-package devDeps to root', async () => {
    const tmp = await makeProject(
      { devDependencies: {}, private: true, workspaces: ['apps/*'] },
      { 'apps/web/package.json': { devDependencies: { '@types/react': 'latest' }, name: '@a/web', private: true } }
    )
    await syncSubPackages(selfPath, tmp)
    const rootPkg = (await file(join(tmp, 'package.json')).json()) as Record<string, Record<string, string>>
    expect(rootPkg.devDependencies?.['@types/react']).toBe('latest')
    const subPkg = (await file(join(tmp, 'apps/web/package.json')).json()) as Record<string, unknown>
    expect(subPkg.devDependencies).toBeUndefined()
    await rm(tmp, { recursive: true })
  })
  test('idempotent — second run produces no issues', async () => {
    const tmp = await makeProject(
      { private: true, workspaces: ['apps/*'] },
      { 'apps/web/package.json': { name: '@a/web', private: true } }
    )
    await syncSubPackages(selfPath, tmp)
    const issues = await syncSubPackages(selfPath, tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('does not add empty devDependencies to packages without them', async () => {
    const tmp = await makeProject(
      { private: true, workspaces: ['packages/*'] },
      { 'packages/lib/package.json': { dependencies: { zod: 'latest' }, name: '@a/lib', private: true } }
    )
    await syncSubPackages(selfPath, tmp)
    const pkg = (await file(join(tmp, 'packages/lib/package.json')).json()) as Record<string, unknown>
    expect(pkg.devDependencies).toBeUndefined()
    await rm(tmp, { recursive: true })
  })
})
describe('syncTsconfig', () => {
  test('removes include from root tsconfig', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'tsconfig.json'), JSON.stringify({ extends: 'lintmax/tsconfig', include: ['*.ts'] }))
    const issues = await syncTsconfig(tmp)
    expect(issues.some(i => i.detail.includes('removed'))).toBe(true)
    const tsconfig = (await file(join(tmp, 'tsconfig.json')).json()) as Record<string, unknown>
    expect(tsconfig.include).toBeUndefined()
    expect(tsconfig.extends).toBe('lintmax/tsconfig')
    await rm(tmp, { recursive: true })
  })
  test('no-op when tsconfig is correct', async () => {
    const tmp = await makeTmp()
    await write(
      join(tmp, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { types: ['bun-types'] }, extends: 'lintmax/tsconfig' })
    )
    const issues = await syncTsconfig(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('no-op when tsconfig does not exist', async () => {
    const tmp = await makeTmp()
    const issues = await syncTsconfig(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('preserves other tsconfig fields', async () => {
    const tmp = await makeTmp()
    await write(
      join(tmp, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { types: ['bun-types'] },
        extends: 'lintmax/tsconfig',
        include: ['*.ts']
      })
    )
    await syncTsconfig(tmp)
    const tsconfig = (await file(join(tmp, 'tsconfig.json')).json()) as Record<string, unknown>
    expect(tsconfig.extends).toBe('lintmax/tsconfig')
    expect(tsconfig.compilerOptions).toBeDefined()
    expect(tsconfig.include).toBeUndefined()
    await rm(tmp, { recursive: true })
  })
})
describe('syncClaudeMd', () => {
  test('generates CLAUDE.md from always rules', async () => {
    const selfDir = await makeTmp()
    const projectDir = await makeTmp()
    const rulesDir = join(selfDir, 'apps', 'docs', 'content', 'rules')
    await mkdir(rulesDir, { recursive: true })
    await write(join(rulesDir, 'base.mdx'), '---\ntitle: Base\ninfer: always\n---\nbase content here')
    await write(join(projectDir, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    const issues = await syncClaudeMd(selfDir, projectDir)
    expect(issues.some(i => i.detail.includes('CLAUDE.md'))).toBe(true)
    const content = await file(join(projectDir, 'CLAUDE.md')).text()
    expect(content).toContain('base content here')
    await rm(selfDir, { recursive: true })
    await rm(projectDir, { recursive: true })
  })
  test('no-op when CLAUDE.md already matches', async () => {
    const selfDir = await makeTmp()
    const projectDir = await makeTmp()
    const rulesDir = join(selfDir, 'apps', 'docs', 'content', 'rules')
    await mkdir(rulesDir, { recursive: true })
    await write(join(rulesDir, 'base.mdx'), '---\ntitle: Base\ninfer: always\n---\nbase content here')
    await write(join(projectDir, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    await syncClaudeMd(selfDir, projectDir)
    const issues = await syncClaudeMd(selfDir, projectDir)
    expect(issues.filter(i => i.detail.includes('CLAUDE.md'))).toHaveLength(0)
    await rm(selfDir, { recursive: true })
    await rm(projectDir, { recursive: true })
  })
  test('returns error when rules dir missing', async () => {
    const selfDir = await makeTmp()
    const projectDir = await makeTmp()
    const issues = await syncClaudeMd(selfDir, projectDir)
    expect(issues.some(i => i.type === 'error')).toBe(true)
    await rm(selfDir, { recursive: true })
    await rm(projectDir, { recursive: true })
  })
  test('includes dep-based rules when dep present', async () => {
    const selfDir = await makeTmp()
    const projectDir = await makeTmp()
    const rulesDir = join(selfDir, 'apps', 'docs', 'content', 'rules')
    await mkdir(rulesDir, { recursive: true })
    await write(join(rulesDir, 'react.mdx'), '---\ntitle: React\ninfer: react\n---\nreact rules')
    await write(join(rulesDir, 'base.mdx'), '---\ntitle: Base\ninfer: always\n---\nbase rules')
    await write(
      join(projectDir, 'package.json'),
      JSON.stringify({ dependencies: { react: 'latest' }, name: 'test', private: true })
    )
    await syncClaudeMd(selfDir, projectDir)
    const content = await file(join(projectDir, 'CLAUDE.md')).text()
    expect(content).toContain('base rules')
    expect(content).toContain('react rules')
    await rm(selfDir, { recursive: true })
    await rm(projectDir, { recursive: true })
  })
  test('emits one H1, a Contents list, and topics as H2 with shifted bodies', async () => {
    const selfDir = await makeTmp()
    const projectDir = await makeTmp()
    const rulesDir = join(selfDir, 'apps', 'docs', 'content', 'rules')
    await mkdir(rulesDir, { recursive: true })
    await write(join(rulesDir, 'base.mdx'), '---\ntitle: Base\ninfer: always\n---\n## MUST\n\n- a rule')
    await write(join(projectDir, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    await syncClaudeMd(selfDir, projectDir)
    const content = await file(join(projectDir, 'CLAUDE.md')).text()
    const h1s = content.split('\n').filter(l => l.startsWith('# '))
    expect(h1s).toEqual(['# pm4ai — Managed Repo Guide'])
    expect(content).toContain('## Contents')
    expect(content).toContain('- [Base](#base)')
    expect(content).toContain('## Base')
    expect(content).toContain('### MUST')
    await rm(selfDir, { recursive: true })
    await rm(projectDir, { recursive: true })
  })
})
describe('checkClaudeMdFresh', () => {
  test('flags a stale CLAUDE.md and passes a fresh one', async () => {
    const selfDir = await makeTmp()
    const projectDir = await makeTmp()
    const rulesDir = join(selfDir, 'apps', 'docs', 'content', 'rules')
    await mkdir(rulesDir, { recursive: true })
    await write(join(rulesDir, 'base.mdx'), '---\ntitle: Base\ninfer: always\n---\n## MUST\n\n- a rule')
    await write(join(projectDir, 'package.json'), JSON.stringify({ name: 'test', private: true }))
    await write(join(projectDir, 'CLAUDE.md'), '# outdated hand-written content')
    expect(await checkClaudeMdFresh(selfDir, projectDir)).not.toHaveLength(0)
    await syncClaudeMd(selfDir, projectDir)
    expect(await checkClaudeMdFresh(selfDir, projectDir)).toHaveLength(0)
    await rm(selfDir, { recursive: true })
    await rm(projectDir, { recursive: true })
  })
})
describe('syncUi', () => {
  test('copies readonly/ui from cnsync to project', async () => {
    const cnsync = await makeTmp()
    const project = await makeTmp()
    const src = join(cnsync, 'readonly', 'ui', 'src')
    await mkdir(src, { recursive: true })
    await write(join(src, 'index.ts'), 'export const x = 1')
    const issues = await syncUi(cnsync, project)
    expect(issues.some(i => i.detail.includes('updated'))).toBe(true)
    expect(await file(join(project, 'readonly', 'ui', 'src', 'index.ts')).exists()).toBe(true)
    await rm(cnsync, { recursive: true })
    await rm(project, { recursive: true })
  })
  test('returns error when cnsync ui dir missing', async () => {
    const cnsync = await makeTmp()
    const project = await makeTmp()
    const issues = await syncUi(cnsync, project)
    expect(issues.some(i => i.type === 'error')).toBe(true)
    await rm(cnsync, { recursive: true })
    await rm(project, { recursive: true })
  })
  test('skips when project is cnsync itself', async () => {
    const cnsync = await makeTmp()
    const src = join(cnsync, 'readonly', 'ui')
    await mkdir(src, { recursive: true })
    await write(join(src, 'test.ts'), 'x')
    const issues = await syncUi(cnsync, cnsync)
    expect(issues).toHaveLength(0)
    await rm(cnsync, { recursive: true })
  })
})
describe('syncSubPackages edge cases', () => {
  const selfPath = join(import.meta.dirname, '..', '..')
  test('preserves workspace devDeps during hoisting', async () => {
    const tmp = await makeProject(
      { devDependencies: {}, private: true, workspaces: ['packages/*'] },
      {
        'packages/lib/package.json': {
          devDependencies: { '@a/other': 'workspace:*', vitest: 'latest' },
          name: '@a/lib',
          private: true
        }
      }
    )
    await syncSubPackages(selfPath, tmp)
    const subPkg = (await file(join(tmp, 'packages/lib/package.json')).json()) as Record<string, Record<string, string>>
    expect(subPkg.devDependencies?.['@a/other']).toBe('workspace:*')
    expect(subPkg.devDependencies?.vitest).toBeUndefined()
    const rootPkg = (await file(join(tmp, 'package.json')).json()) as Record<string, Record<string, string>>
    expect(rootPkg.devDependencies?.vitest).toBe('latest')
    await rm(tmp, { recursive: true })
  })
  test('sets files field on published packages', async () => {
    const tmp = await makeProject(
      { private: true, workspaces: ['packages/*'] },
      { 'packages/lib/package.json': { exports: { '.': './dist/index.js' }, name: 'my-lib' } }
    )
    await syncSubPackages(selfPath, tmp)
    const pkg = (await file(join(tmp, 'packages/lib/package.json')).json()) as Record<string, unknown>
    expect(pkg.files).toEqual(['dist'])
    await rm(tmp, { recursive: true })
  })
  test('does not modify private packages with no exports', async () => {
    const tmp = await makeProject(
      { private: true, workspaces: ['packages/*'] },
      { 'packages/internal/package.json': { name: '@a/internal', private: true } }
    )
    const issues = await syncSubPackages(selfPath, tmp)
    expect(issues.filter(i => i.detail.includes('type') || i.detail.includes('license'))).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('handles project with no sub-packages', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'solo', private: true }))
    const issues = await syncSubPackages(selfPath, tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
})
describe('syncPackageJson edge cases', () => {
  test('returns empty for missing package.json', async () => {
    const tmp = await makeTmp()
    const issues = await syncPackageJson(tmp, pm4aiRoot)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('sorts devDependencies alphabetically', async () => {
    const tmp = await makeTmp()
    await write(
      join(tmp, 'package.json'),
      JSON.stringify({ devDependencies: { axios: 'latest', zod: 'latest' }, name: 'test', private: true })
    )
    await syncPackageJson(tmp, pm4aiRoot)
    const parsed = (await file(join(tmp, 'package.json')).json()) as Record<string, Record<string, string>>
    const keys = Object.keys(parsed.devDependencies ?? {})
    const sorted = [...keys].toSorted((a, b) => (a < b ? -1 : Number(a > b)))
    expect(keys).toEqual(sorted)
    await rm(tmp, { recursive: true })
  })
  test('does not overwrite existing packageManager', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'test', packageManager: 'bun@1.0.0', private: true }))
    await syncPackageJson(tmp, pm4aiRoot)
    const pkg = (await file(join(tmp, 'package.json')).json()) as Record<string, string>
    expect(pkg.packageManager).toBe('bun@1.0.0')
    await rm(tmp, { recursive: true })
  })
})
describe('serializeTsdownConfig — prettier-canonical output', () => {
  test('emits blank line between import and export so prettier leaves it alone', () => {
    const out = serializeTsdownConfig({ entry: ['src/index.ts'] })
    expect(out).toContain("import { defineConfig } from 'tsdown'\n\nexport default")
  })
  test('idempotent: serialising the same config twice returns the same string', () => {
    const cfg = { copy: ['static'], entry: ['src/index.ts'] }
    expect(serializeTsdownConfig(cfg)).toBe(serializeTsdownConfig(cfg))
  })
})
