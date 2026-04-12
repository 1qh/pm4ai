import { describe, expect, test } from 'bun:test'
import type { PkgEntry } from '../audit.js'
import {
  checkAppPackages,
  checkDuplicates,
  checkNotLatest,
  checkPackageConventions,
  checkPublishedPkgConventions,
  checkRootScripts,
  checkRootWorkspacesAndDevDeps,
  checkScripts,
  checkSubPkgScripts,
  checkTrustedDeps,
  usesForbidden
} from '../audit.js'
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
  test('required root devDeps not flagged as duplicates', () => {
    const root = entry('package.json', {
      devDependencies: { lintmax: 'workspace:*', typescript: 'latest' },
      private: true
    })
    const lib = entry('packages/lib/package.json', {
      dependencies: { typescript: 'latest' },
      name: 'lintmax'
    })
    const issues = checkDuplicates([root, lib], PROJECT)
    expect(issues.filter(i => i.detail.includes('typescript'))).toHaveLength(0)
  })
  test('non-required root devDeps still flagged as duplicates', () => {
    const root = entry('package.json', {
      devDependencies: { lintmax: 'workspace:*', zod: 'latest' },
      private: true
    })
    const lib = entry('packages/lib/package.json', {
      dependencies: { zod: '^3' },
      name: 'lintmax'
    })
    const issues = checkDuplicates([root, lib], PROJECT)
    expect(issues.some(i => i.detail.includes('zod'))).toBe(true)
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
describe('checkRootScripts', () => {
  test('missing turbo in build is flagged', () => {
    const issues = checkRootScripts({ scripts: { build: 'tsc' } })
    expect(issues.some(i => i.detail.includes('turbo'))).toBe(true)
  })
  test('build with turbo is not flagged', () => {
    const issues = checkRootScripts({ scripts: { build: 'turbo build --output-logs=errors-only' } })
    expect(issues.filter(i => i.detail.includes('build'))).toHaveLength(0)
  })
  test('check without lintmax is flagged', () => {
    const issues = checkRootScripts({ scripts: { check: 'tsc --noEmit' } })
    expect(issues.some(i => i.detail.includes('lintmax check'))).toBe(true)
  })
  test('fix without lintmax is flagged', () => {
    const issues = checkRootScripts({ scripts: { fix: 'prettier --write .' } })
    expect(issues.some(i => i.detail.includes('lintmax fix'))).toBe(true)
  })
  test('fix with lintmax fix plus extra is not flagged', () => {
    const issues = checkRootScripts({ scripts: { fix: 'lintmax fix && turbo build' } })
    expect(issues.filter(i => i.detail.includes('fix'))).toHaveLength(0)
  })
})
describe('checkRootWorkspacesAndDevDeps', () => {
  test('missing workspaces is flagged', () => {
    const issues = checkRootWorkspacesAndDevDeps({
      devDependencies: {
        '@types/bun': 'latest',
        lintmax: 'latest',
        sherif: 'latest',
        'simple-git-hooks': 'latest',
        tsdown: 'latest',
        turbo: 'latest',
        typescript: 'latest'
      }
    })
    expect(issues.some(i => i.detail.includes('workspaces'))).toBe(true)
  })
  test('missing turbo devDep is flagged', () => {
    const issues = checkRootWorkspacesAndDevDeps({ devDependencies: { lintmax: 'latest' }, workspaces: ['packages/*'] })
    expect(issues.some(i => i.detail.includes('turbo'))).toBe(true)
  })
  test('all present is clean', () => {
    const issues = checkRootWorkspacesAndDevDeps({
      devDependencies: {
        '@types/bun': 'latest',
        lintmax: 'latest',
        sherif: 'latest',
        'simple-git-hooks': 'latest',
        tsdown: 'latest',
        turbo: 'latest',
        typescript: 'latest'
      },
      workspaces: ['packages/*']
    })
    expect(issues).toHaveLength(0)
  })
  test('workspace:* lintmax in deps is accepted', () => {
    const issues = checkRootWorkspacesAndDevDeps({
      dependencies: { lintmax: 'workspace:*' },
      devDependencies: {
        '@types/bun': 'latest',
        sherif: 'latest',
        'simple-git-hooks': 'latest',
        turbo: 'latest',
        typescript: 'latest'
      },
      workspaces: ['packages/*']
    })
    expect(issues.filter(i => i.detail.includes('lintmax'))).toHaveLength(0)
  })
})
describe('checkTrustedDeps', () => {
  test('missing trustedDependencies is flagged', () => {
    const issues = checkTrustedDeps({})
    expect(issues.some(i => i.detail.includes('lintmax'))).toBe(true)
  })
  test('trustedDependencies with all required is clean', () => {
    const issues = checkTrustedDeps({ trustedDependencies: ['esbuild', 'lintmax', 'msw', 'sharp', 'simple-git-hooks'] })
    expect(issues).toHaveLength(0)
  })
  test('trustedDependencies without lintmax is flagged', () => {
    const issues = checkTrustedDeps({ trustedDependencies: ['esbuild'] })
    expect(issues.some(i => i.detail.includes('lintmax'))).toBe(true)
  })
})
describe('checkPublishedPkgConventions', () => {
  test('published pkg without postpublish is flagged', () => {
    const pkgs = [entry('packages/lib/package.json', { bin: './cli.js', name: 'lib', scripts: {} })]
    const issues = checkPublishedPkgConventions(pkgs, PROJECT)
    expect(issues.some(i => i.detail.includes('postpublish'))).toBe(true)
  })
  test('published pkg with postpublish has no postpublish drift', () => {
    const pkgs = [
      entry('packages/lib/package.json', { bin: './cli.js', name: 'lib', scripts: { postpublish: 'bun run cleanup' } })
    ]
    const issues = checkPublishedPkgConventions(pkgs, PROJECT)
    expect(issues.filter(i => i.detail.includes('missing "postpublish"'))).toHaveLength(0)
  })
  test('private pkg without postpublish is not flagged', () => {
    const pkgs = [entry('packages/lib/package.json', { name: 'lib', private: true })]
    const issues = checkPublishedPkgConventions(pkgs, PROJECT)
    expect(issues).toHaveLength(0)
  })
})
describe('checkAppPackages', () => {
  test('app without private is flagged', () => {
    const pkgs = [entry('apps/web/package.json', { name: '@a/web' })]
    const issues = checkAppPackages(pkgs, PROJECT)
    expect(issues.some(i => i.detail.includes('private'))).toBe(true)
  })
  test('private app is clean', () => {
    const pkgs = [entry('apps/web/package.json', { name: '@a/web', private: true })]
    const issues = checkAppPackages(pkgs, PROJECT)
    expect(issues).toHaveLength(0)
  })
  test('non-app package is not checked', () => {
    const pkgs = [entry('packages/lib/package.json', { name: 'lib' })]
    const issues = checkAppPackages(pkgs, PROJECT)
    expect(issues).toHaveLength(0)
  })
})
describe('checkSubPkgScripts', () => {
  test('git clean in sub-package is flagged', () => {
    const pkgs = [
      entry('package.json', { private: true }),
      entry('apps/web/package.json', { scripts: { clean: 'git clean -xdf .next node_modules' } })
    ]
    const issues = checkSubPkgScripts(pkgs, PROJECT)
    expect(issues.some(i => i.detail.includes('git clean'))).toBe(true)
  })
  test('rm -rf in sub-package is not flagged', () => {
    const pkgs = [
      entry('package.json', { private: true }),
      entry('apps/web/package.json', { scripts: { clean: 'rm -rf .next node_modules' } })
    ]
    const issues = checkSubPkgScripts(pkgs, PROJECT)
    expect(issues).toHaveLength(0)
  })
})
