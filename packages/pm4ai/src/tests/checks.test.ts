import { describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkCi,
  checkConfigs,
  checkConvexSelfHosted,
  checkDrift,
  checkForbidden,
  checkGit,
  checkMergeMarkers,
  checkRootPkg,
  checkVercel
} from '../checks.js'
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
  test('counts number of uncommitted changes', async () => {
    const tmp = makeGitRepo()
    writeFileSync(join(tmp, 'a.txt'), 'a')
    writeFileSync(join(tmp, 'b.txt'), 'b')
    writeFileSync(join(tmp, 'c.txt'), 'c')
    const issues = await checkGit(tmp)
    expect(issues.some(i => i.detail.includes('3 uncommitted'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('clean repo with remote has no issues', async () => {
    const remote = makeTmp()
    execSync('git init --bare', { cwd: remote, stdio: 'pipe' })
    const local = makeTmp()
    execSync(`git clone ${remote} ${local}`, { stdio: 'pipe' })
    execSync('git -c user.name=test -c user.email=test@test commit --allow-empty -m init', { cwd: local, stdio: 'pipe' })
    execSync('git push', { cwd: local, stdio: 'pipe' })
    const issues = await checkGit(local)
    expect(issues).toEqual([])
    rmSync(remote, { recursive: true })
    rmSync(local, { recursive: true })
  })
})
describe('checkDrift', () => {
  test('reports missing file', async () => {
    const src = makeTmp()
    const dst = makeTmp()
    writeFileSync(join(src, 'clean.sh'), '#!/bin/sh\nrm -rf dist')
    const issues = await checkDrift(src, dst)
    expect(issues.some(i => i.detail.includes('clean.sh') && i.detail.includes('missing'))).toBe(true)
    rmSync(src, { recursive: true })
    rmSync(dst, { recursive: true })
  })
  test('reports out of sync file', async () => {
    const src = makeTmp()
    const dst = makeTmp()
    writeFileSync(join(src, 'clean.sh'), 'version A')
    writeFileSync(join(dst, 'clean.sh'), 'version B')
    const issues = await checkDrift(src, dst)
    expect(issues.some(i => i.detail.includes('clean.sh') && i.detail.includes('out of sync'))).toBe(true)
    rmSync(src, { recursive: true })
    rmSync(dst, { recursive: true })
  })
  test('no issues when files match', async () => {
    const src = makeTmp()
    const dst = makeTmp()
    writeFileSync(join(src, 'clean.sh'), 'same content')
    writeFileSync(join(dst, 'clean.sh'), 'same content')
    const issues = await checkDrift(src, dst)
    expect(issues.filter(i => i.detail.includes('clean.sh'))).toHaveLength(0)
    rmSync(src, { recursive: true })
    rmSync(dst, { recursive: true })
  })
})
describe('checkCi', () => {
  test('returns empty for non-git project', async () => {
    const tmp = makeTmp()
    const issues = await checkCi(tmp)
    expect(issues).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
  test('returns result for real pm4ai repo', async () => {
    const pm4aiPath = join(import.meta.dirname, '..', '..', '..', '..')
    const issues = await checkCi(pm4aiPath)
    expect(issues.length).toBeGreaterThanOrEqual(0)
    if (issues.length > 0) expect(issues[0]?.type === 'ci' || issues[0]?.type === 'info').toBe(true)
  })
})
describe('checkVercel', () => {
  test('returns empty when no .vercel directory', async () => {
    const tmp = makeTmp()
    const issues = await checkVercel(tmp)
    expect(issues).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
})
describe('checkRootPkg edge cases', () => {
  test('reports wrong pre-commit hook', async () => {
    const tmp = makeTmp()
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({
        packageManager: 'bun@1.2.0',
        private: true,
        scripts: { postinstall: 'sherif', prepare: 'bunx simple-git-hooks' },
        'simple-git-hooks': { 'pre-commit': 'wrong command' }
      })
    )
    const issues = await checkRootPkg(tmp)
    expect(issues.some(i => i.detail.includes('pre-commit'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('reports wrong prepare script', async () => {
    const tmp = makeTmp()
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({
        packageManager: 'bun@1.2.0',
        private: true,
        scripts: { postinstall: 'sherif', prepare: 'wrong' },
        'simple-git-hooks': { 'pre-commit': 'sh up.sh && git add -u' }
      })
    )
    const issues = await checkRootPkg(tmp)
    expect(issues.some(i => i.detail.includes('prepare'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('reports postinstall without sherif', async () => {
    const tmp = makeTmp()
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({
        packageManager: 'bun@1.2.0',
        private: true,
        scripts: { postinstall: 'echo hello', prepare: 'bunx simple-git-hooks' },
        'simple-git-hooks': { 'pre-commit': 'sh up.sh && git add -u' }
      })
    )
    const issues = await checkRootPkg(tmp)
    expect(issues.some(i => i.detail.includes('sherif'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('returns empty for missing package.json', async () => {
    const tmp = makeTmp()
    const issues = await checkRootPkg(tmp)
    expect(issues).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
  test('reports clean script not starting with sh clean.sh', async () => {
    const tmp = makeTmp()
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({
        packageManager: 'bun@1.2.0',
        private: true,
        scripts: { clean: 'rm -rf dist', postinstall: 'sherif', prepare: 'bunx simple-git-hooks' },
        'simple-git-hooks': { 'pre-commit': 'sh up.sh && git add -u' }
      })
    )
    const issues = await checkRootPkg(tmp)
    expect(issues.some(i => i.detail.includes('clean'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
})
describe('checkForbidden edge cases', () => {
  test('flags @ts-nocheck in TypeScript files', async () => {
    const tmp = makeTmp()
    execSync('git init', { cwd: tmp, stdio: 'pipe' })
    mkdirSync(join(tmp, 'src'), { recursive: true })
    writeFileSync(join(tmp, 'src', 'bad.ts'), '// @ts-nocheck\nconst x = 1')
    const issues = await checkForbidden(tmp)
    expect(issues.some(i => i.detail.includes('@ts-nocheck'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('flags pnpm-lock.yaml', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'pnpm-lock.yaml'), 'lockfileVersion: 5')
    const issues = await checkForbidden(tmp)
    expect(issues.some(i => i.detail.includes('pnpm-lock.yaml'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('no issues for clean project', async () => {
    const tmp = makeTmp()
    const issues = await checkForbidden(tmp)
    const lockIssues = issues.filter(i => i.type === 'forbidden' && !i.detail.includes('bun.lock'))
    expect(lockIssues).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
})
describe('checkConfigs edge cases', () => {
  test('reports wrong tsconfig extends', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'turbo.json'), '{}')
    writeFileSync(join(tmp, 'tsconfig.json'), JSON.stringify({ extends: '@other/config' }))
    const issues = await checkConfigs(tmp)
    expect(issues.some(i => i.detail.includes('should extend lintmax/tsconfig'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('reports wrong vercel installCommand', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'turbo.json'), '{}')
    writeFileSync(join(tmp, 'tsconfig.json'), JSON.stringify({ extends: 'lintmax/tsconfig' }))
    writeFileSync(join(tmp, 'vercel.json'), JSON.stringify({ installCommand: 'npm install' }))
    const issues = await checkConfigs(tmp)
    expect(issues.some(i => i.detail.includes('installCommand'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('no vercel issue when installCommand is correct', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'turbo.json'), '{}')
    writeFileSync(join(tmp, 'tsconfig.json'), JSON.stringify({ extends: 'lintmax/tsconfig' }))
    writeFileSync(join(tmp, 'vercel.json'), JSON.stringify({ installCommand: 'bun i' }))
    const issues = await checkConfigs(tmp)
    expect(issues.filter(i => i.detail.includes('installCommand'))).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
})
describe('checkMergeMarkers', () => {
  test('no issues on clean tree', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'a.ts'), 'export const x = 1\n')
    const issues = await checkMergeMarkers(tmp)
    expect(issues).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
  test('flags conflict markers', async () => {
    const tmp = makeTmp()
    writeFileSync(join(tmp, 'a.ts'), '<<<<<<< HEAD\nfoo\n=======\nbar\n>>>>>>> branch\n')
    const issues = await checkMergeMarkers(tmp)
    expect(issues).toHaveLength(1)
    expect(issues[0].detail).toContain('a.ts')
    rmSync(tmp, { recursive: true })
  })
})
describe('checkConvexSelfHosted', () => {
  test('skips non-convex projects', async () => {
    const tmp = makeTmp()
    const issues = await checkConvexSelfHosted(tmp)
    expect(issues).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
  test('skips when convex but no self-hosted env', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'convex', '_generated'), { recursive: true })
    writeFileSync(join(tmp, 'convex', '_generated', 'api.d.ts'), '')
    const issues = await checkConvexSelfHosted(tmp)
    expect(issues).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
  test('flags missing JWT_PRIVATE_KEY when @convex-dev/auth used', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'convex', '_generated'), { recursive: true })
    writeFileSync(join(tmp, 'convex', '_generated', 'api.d.ts'), '')
    writeFileSync(join(tmp, '.env'), 'CONVEX_SELF_HOSTED_URL=https://x\nSITE_URL=https://y\n')
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ dependencies: { '@convex-dev/auth': 'latest' } }))
    const issues = await checkConvexSelfHosted(tmp)
    const details = issues.map(i => i.detail)
    expect(details.some(d => d.includes('JWT_PRIVATE_KEY'))).toBe(true)
    expect(details.some(d => d.includes('JWKS'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('flags missing SITE_URL', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'convex', '_generated'), { recursive: true })
    writeFileSync(join(tmp, 'convex', '_generated', 'api.d.ts'), '')
    writeFileSync(join(tmp, '.env'), 'CONVEX_SELF_HOSTED_URL=https://x\n')
    const issues = await checkConvexSelfHosted(tmp)
    expect(issues.some(i => i.detail.includes('SITE_URL'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test("flags NODE_ENV === 'production' branch (dot)", async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'convex', '_generated'), { recursive: true })
    writeFileSync(join(tmp, 'convex', '_generated', 'api.d.ts'), '')
    writeFileSync(join(tmp, 'convex', 'foo.ts'), "if (process.env.NODE_ENV === 'production') throw new Error('x')\n")
    writeFileSync(join(tmp, '.env'), 'CONVEX_SELF_HOSTED_URL=https://x\nSITE_URL=https://y\n')
    const issues = await checkConvexSelfHosted(tmp)
    expect(issues.some(i => i.detail.includes('NODE_ENV'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test("flags NODE_ENV === 'production' branch (single-quote bracket)", async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'convex', '_generated'), { recursive: true })
    writeFileSync(join(tmp, 'convex', '_generated', 'api.d.ts'), '')
    writeFileSync(join(tmp, 'convex', 'bar.ts'), "if (process.env['NODE_ENV'] === 'production') throw new Error('x')\n")
    writeFileSync(join(tmp, '.env'), 'CONVEX_SELF_HOSTED_URL=https://x\nSITE_URL=https://y\n')
    const issues = await checkConvexSelfHosted(tmp)
    expect(issues.some(i => i.detail.includes('NODE_ENV'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test("flags NODE_ENV === 'production' branch (double-quote bracket)", async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'convex', '_generated'), { recursive: true })
    writeFileSync(join(tmp, 'convex', '_generated', 'api.d.ts'), '')
    writeFileSync(join(tmp, 'convex', 'baz.ts'), 'if (process.env["NODE_ENV"] === "production") throw new Error("x")\n')
    writeFileSync(join(tmp, '.env'), 'CONVEX_SELF_HOSTED_URL=https://x\nSITE_URL=https://y\n')
    const issues = await checkConvexSelfHosted(tmp)
    expect(issues.some(i => i.detail.includes('NODE_ENV'))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test("does NOT flag NODE_ENV === 'test' (legitimate test-context bypass)", async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'convex', '_generated'), { recursive: true })
    writeFileSync(join(tmp, 'convex', '_generated', 'api.d.ts'), '')
    writeFileSync(join(tmp, 'convex', 'qux.ts'), "if (process.env['NODE_ENV'] === 'test') return null\n")
    writeFileSync(join(tmp, '.env'), 'CONVEX_SELF_HOSTED_URL=https://x\nSITE_URL=https://y\n')
    const issues = await checkConvexSelfHosted(tmp)
    expect(issues.some(i => i.detail.includes('NODE_ENV'))).toBe(false)
    rmSync(tmp, { recursive: true })
  })
  test('flags convex env set outside sync.ts', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'convex', '_generated'), { recursive: true })
    writeFileSync(join(tmp, 'convex', '_generated', 'api.d.ts'), '')
    mkdirSync(join(tmp, 'scripts'), { recursive: true })
    writeFileSync(join(tmp, 'scripts', 'bad.ts'), 'await $`convex env set FOO bar`\n')
    writeFileSync(join(tmp, '.env'), 'CONVEX_SELF_HOSTED_URL=https://x\nSITE_URL=https://y\n')
    const issues = await checkConvexSelfHosted(tmp)
    expect(issues.some(i => i.detail.includes("'convex env set'"))).toBe(true)
    rmSync(tmp, { recursive: true })
  })
  test('clean self-hosted convex passes', async () => {
    const tmp = makeTmp()
    mkdirSync(join(tmp, 'convex', '_generated'), { recursive: true })
    writeFileSync(join(tmp, 'convex', '_generated', 'api.d.ts'), '')
    writeFileSync(join(tmp, '.env'), 'CONVEX_SELF_HOSTED_URL=https://x\nSITE_URL=https://y\nJWT_PRIVATE_KEY=k\nJWKS=j\n')
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ dependencies: { '@convex-dev/auth': 'latest' } }))
    const issues = await checkConvexSelfHosted(tmp)
    expect(issues).toHaveLength(0)
    rmSync(tmp, { recursive: true })
  })
})
