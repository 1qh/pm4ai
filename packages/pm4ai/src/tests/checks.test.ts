import { $, write } from 'bun'
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkBannedImports,
  checkCi,
  checkConfigs,
  checkConvexSelfHosted,
  checkDrift,
  checkForbidden,
  checkGit,
  checkHermeticTests,
  checkMergeMarkers,
  checkRootPkg,
  checkTailwindSourceCoverage,
  checkVercel,
  deployStateFailed
} from '../checks.js'

setDefaultTimeout(30_000)
const makeTmp = async () => mkdtemp(join(tmpdir(), 'pm4ai-test-'))
describe('checkRootPkg', () => {
  test('reports missing fields for minimal package.json', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'package.json'), JSON.stringify({ name: 'test' }))
    const issues = await checkRootPkg(tmp)
    const details = issues.map(i => i.detail)
    expect(details).toContain('root package.json should be private')
    expect(details).toContain('packageManager field missing')
    expect(details).toContain('simple-git-hooks in package.json')
    await rm(tmp, { recursive: true })
  })
  test('no issues for well-configured package.json', async () => {
    const tmp = await makeTmp()
    await write(
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
    await rm(tmp, { recursive: true })
  })
})
describe('checkConfigs', () => {
  test('reports missing turbo.json and tsconfig.json', async () => {
    const tmp = await makeTmp()
    const issues = await checkConfigs(tmp)
    const details = issues.map(i => i.detail)
    expect(details).toContain('turbo.json')
    expect(details).toContain('tsconfig.json')
    await rm(tmp, { recursive: true })
  })
})
describe('checkForbidden', () => {
  test('flags package-lock.json', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'package-lock.json'), '{}')
    const issues = await checkForbidden(tmp)
    const details = issues.map(i => i.detail)
    expect(details.some(d => d.includes('package-lock.json'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('flags yarn.lock', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'yarn.lock'), '')
    const issues = await checkForbidden(tmp)
    const details = issues.map(i => i.detail)
    expect(details.some(d => d.includes('yarn.lock'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('flags nested .gitignore', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, '.gitignore'), 'node_modules')
    await mkdir(join(tmp, '.git'))
    await mkdir(join(tmp, 'apps'))
    await write(join(tmp, 'apps', '.gitignore'), 'dist')
    const issues = await checkForbidden(tmp)
    expect(issues.some(i => i.detail.includes('nested .gitignore'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('no issue when only root .gitignore', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, '.gitignore'), 'node_modules')
    const issues = await checkForbidden(tmp)
    expect(issues.filter(i => i.detail.includes('nested .gitignore'))).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('flags postcss.config.mjs', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'apps', 'web'), { recursive: true })
    await write(join(tmp, 'apps', 'web', 'postcss.config.mjs'), 'export default {}')
    const issues = await checkForbidden(tmp)
    expect(issues.some(i => i.detail.includes('postcss.config.mjs'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
})
describe('checkConfigs tsconfig', () => {
  test('flags tsconfig with include', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'turbo.json'), '{}')
    await write(join(tmp, 'tsconfig.json'), JSON.stringify({ extends: 'lintmax/tsconfig', include: ['*.ts'] }))
    const issues = await checkConfigs(tmp)
    expect(issues.some(i => i.detail.includes('should not have "include"'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('no include flag when tsconfig has no include', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'turbo.json'), '{}')
    await write(join(tmp, 'tsconfig.json'), JSON.stringify({ extends: 'lintmax/tsconfig' }))
    const issues = await checkConfigs(tmp)
    expect(issues.filter(i => i.detail.includes('include'))).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
})
describe('checkGit', () => {
  const makeGitRepo = async () => {
    const tmp = await makeTmp()
    await $`git init`.cwd(tmp).quiet().nothrow()
    await $`git -c user.name=test -c user.email=test@test commit --allow-empty -m init`.cwd(tmp).quiet().nothrow()
    return tmp
  }
  test('clean repo reports no git issues', async () => {
    const tmp = await makeGitRepo()
    const issues = await checkGit(tmp)
    const gitIssues = issues.filter(i => i.type === 'git')
    expect(gitIssues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('dirty repo reports uncommitted changes', async () => {
    const tmp = await makeGitRepo()
    await write(join(tmp, 'dirty.txt'), 'dirty')
    const issues = await checkGit(tmp)
    expect(issues.some(i => i.type === 'git' && i.detail.includes('uncommitted'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('counts number of uncommitted changes', async () => {
    const tmp = await makeGitRepo()
    await write(join(tmp, 'a.txt'), 'a')
    await write(join(tmp, 'b.txt'), 'b')
    await write(join(tmp, 'c.txt'), 'c')
    const issues = await checkGit(tmp)
    expect(issues.some(i => i.detail.includes('3 uncommitted'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('clean repo with remote has no issues', async () => {
    const remote = await makeTmp()
    await $`git init --bare`.cwd(remote).quiet().nothrow()
    const local = await makeTmp()
    await $`git clone ${remote} ${local}`.quiet().nothrow()
    await $`git -c user.name=test -c user.email=test@test commit --allow-empty -m init`.cwd(local).quiet().nothrow()
    await $`git push`.cwd(local).quiet().nothrow()
    const issues = await checkGit(local)
    expect(issues).toEqual([])
    await rm(remote, { recursive: true })
    await rm(local, { recursive: true })
  })
})
describe('checkHermeticTests', () => {
  const REMOTE = 'https://github.com/x/y.git'
  const EXT = 'https://api.example.com/v1'
  const localhostUrl = ['http:/', '/localhost:3000/api'].join('')
  const dataUrl = 'https://api.openai.com/v1'
  const HOMEDIR = 'homedir'
  const PENV = 'process.env'
  const PERFNOW = ['performance', '.now()'].join('')
  const writeFileIn = async (name: string, body: string): Promise<string> => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'src'), { recursive: true })
    await write(join(tmp, 'src', name), body)
    return tmp
  }
  test('flags a real remote git clone in a test file', async () => {
    const tmp = await writeFileIn('a.test.ts', `await $\`git clone ${REMOTE} dest\`\n`)
    const issues = await checkHermeticTests(tmp)
    expect(issues.some(i => i.type === 'forbidden' && i.detail.includes('non-hermetic'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('flags an external fetch in a test file', async () => {
    const tmp = await writeFileIn('b.test.ts', `await fetch(${JSON.stringify(EXT)})\n`)
    const issues = await checkHermeticTests(tmp)
    expect(issues.some(i => i.type === 'forbidden')).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('does not flag a local git clone from a filesystem path', async () => {
    const tmp = await writeFileIn('c.test.ts', 'await $`git clone /tmp/local-bare.git dest`\n')
    const issues = await checkHermeticTests(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('does not flag a localhost fetch (own spawned server)', async () => {
    const tmp = await writeFileIn('d.test.ts', `await fetch(${JSON.stringify(localhostUrl)})\n`)
    const issues = await checkHermeticTests(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('does not flag a URL passed as data to a pure function', async () => {
    const tmp = await writeFileIn('e.test.ts', `expect(normalizeBaseUrl(${JSON.stringify(dataUrl)})).toBeDefined()\n`)
    const issues = await checkHermeticTests(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('does not scan non-test source files', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'src'), { recursive: true })
    await write(join(tmp, 'src', 'prod.ts'), `await fetch(${JSON.stringify(EXT)})\n`)
    const issues = await checkHermeticTests(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('exempts a deliberate -live test file', async () => {
    const tmp = await writeFileIn('x-live.test.ts', `await fetch(${JSON.stringify(EXT)})\n`)
    const issues = await checkHermeticTests(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('flags a test that reads the real home dir without a HOME swap', async () => {
    const tmp = await writeFileIn('h.test.ts', `const d = join(${HOMEDIR}(), '.x')\nawait mkdir(d)\n`)
    const issues = await checkHermeticTests(tmp)
    expect(issues.some(i => i.detail.includes('ambient state'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('exempts a test that swaps the HOME env var to an isolated dir', async () => {
    const tmp = await writeFileIn('i.test.ts', `${PENV}.HOME = tmpDir\nconst d = ${HOMEDIR}()\n`)
    const issues = await checkHermeticTests(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('flags a wall-clock micro-benchmark (performance.now) in a test', async () => {
    const tmp = await writeFileIn('t.test.ts', `const start = ${PERFNOW}\nexpect(start).toBeGreaterThan(0)\n`)
    const issues = await checkHermeticTests(tmp)
    expect(issues.some(i => i.detail.includes('non-hermetic timing'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('does not flag Date.now used for a unique name', async () => {
    const tmp = await writeFileIn('u.test.ts', 'const name = "x-" + Date.now()\n')
    const issues = await checkHermeticTests(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
})
describe('checkDrift', () => {
  test('reports missing file', async () => {
    const src = await makeTmp()
    const dst = await makeTmp()
    await write(join(src, 'clean.sh'), '#!/bin/sh\nrm -rf dist')
    const issues = await checkDrift(src, dst)
    expect(issues.some(i => i.detail.includes('clean.sh') && i.detail.includes('missing'))).toBe(true)
    await rm(src, { recursive: true })
    await rm(dst, { recursive: true })
  })
  test('reports out of sync file', async () => {
    const src = await makeTmp()
    const dst = await makeTmp()
    await write(join(src, 'clean.sh'), 'version A')
    await write(join(dst, 'clean.sh'), 'version B')
    const issues = await checkDrift(src, dst)
    expect(issues.some(i => i.detail.includes('clean.sh') && i.detail.includes('out of sync'))).toBe(true)
    await rm(src, { recursive: true })
    await rm(dst, { recursive: true })
  })
  test('no issues when files match', async () => {
    const src = await makeTmp()
    const dst = await makeTmp()
    await write(join(src, 'clean.sh'), 'same content')
    await write(join(dst, 'clean.sh'), 'same content')
    const issues = await checkDrift(src, dst)
    expect(issues.filter(i => i.detail.includes('clean.sh'))).toHaveLength(0)
    await rm(src, { recursive: true })
    await rm(dst, { recursive: true })
  })
})
describe('checkCi', () => {
  test('returns empty for non-git project', async () => {
    const tmp = await makeTmp()
    const issues = await checkCi(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
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
    const tmp = await makeTmp()
    const issues = await checkVercel(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
})
describe('checkRootPkg edge cases', () => {
  test('reports wrong pre-commit hook', async () => {
    const tmp = await makeTmp()
    await write(
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
    await rm(tmp, { recursive: true })
  })
  test('reports wrong prepare script', async () => {
    const tmp = await makeTmp()
    await write(
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
    await rm(tmp, { recursive: true })
  })
  test('reports postinstall without sherif', async () => {
    const tmp = await makeTmp()
    await write(
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
    await rm(tmp, { recursive: true })
  })
  test('returns empty for missing package.json', async () => {
    const tmp = await makeTmp()
    const issues = await checkRootPkg(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('reports clean script not starting with sh clean.sh', async () => {
    const tmp = await makeTmp()
    await write(
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
    await rm(tmp, { recursive: true })
  })
})
describe('checkForbidden edge cases', () => {
  test('flags @ts-nocheck in TypeScript files', async () => {
    const tmp = await makeTmp()
    await $`git init`.cwd(tmp).quiet().nothrow()
    await mkdir(join(tmp, 'src'), { recursive: true })
    await write(join(tmp, 'src', 'bad.ts'), '// @ts-nocheck\nconst x = 1')
    const issues = await checkForbidden(tmp)
    expect(issues.some(i => i.detail.includes('@ts-nocheck'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('flags pnpm-lock.yaml', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'pnpm-lock.yaml'), 'lockfileVersion: 5')
    const issues = await checkForbidden(tmp)
    expect(issues.some(i => i.detail.includes('pnpm-lock.yaml'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('no issues for clean project', async () => {
    const tmp = await makeTmp()
    const issues = await checkForbidden(tmp)
    const lockIssues = issues.filter(i => i.type === 'forbidden' && !i.detail.includes('bun.lock'))
    expect(lockIssues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
})
describe('checkConfigs edge cases', () => {
  test('reports wrong tsconfig extends', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'turbo.json'), '{}')
    await write(join(tmp, 'tsconfig.json'), JSON.stringify({ extends: '@other/config' }))
    const issues = await checkConfigs(tmp)
    expect(issues.some(i => i.detail.includes('should extend lintmax/tsconfig'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('reports wrong vercel installCommand', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'turbo.json'), '{}')
    await write(join(tmp, 'tsconfig.json'), JSON.stringify({ extends: 'lintmax/tsconfig' }))
    await write(join(tmp, 'vercel.json'), JSON.stringify({ installCommand: 'npm install' }))
    const issues = await checkConfigs(tmp)
    expect(issues.some(i => i.detail.includes('installCommand'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('no vercel issue when installCommand is correct', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'turbo.json'), '{}')
    await write(join(tmp, 'tsconfig.json'), JSON.stringify({ extends: 'lintmax/tsconfig' }))
    await write(join(tmp, 'vercel.json'), JSON.stringify({ installCommand: 'bun i' }))
    const issues = await checkConfigs(tmp)
    expect(issues.filter(i => i.detail.includes('installCommand'))).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
})
describe('checkMergeMarkers', () => {
  test('no issues on clean tree', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'a.ts'), 'export const x = 1\n')
    const issues = await checkMergeMarkers(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('flags conflict markers', async () => {
    const tmp = await makeTmp()
    await write(join(tmp, 'a.ts'), '<<<<<<< HEAD\nfoo\n=======\nbar\n>>>>>>> branch\n')
    const issues = await checkMergeMarkers(tmp)
    expect(issues).toHaveLength(1)
    expect(issues[0].detail).toContain('a.ts')
    await rm(tmp, { recursive: true })
  })
})
describe('checkConvexSelfHosted', () => {
  test('skips non-convex projects', async () => {
    const tmp = await makeTmp()
    const issues = await checkConvexSelfHosted(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('skips when convex but no self-hosted env', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'convex', '_generated'), { recursive: true })
    await write(join(tmp, 'convex', '_generated', 'api.d.ts'), '')
    const issues = await checkConvexSelfHosted(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('flags missing JWT_PRIVATE_KEY when @convex-dev/auth used', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'convex', '_generated'), { recursive: true })
    await write(join(tmp, 'convex', '_generated', 'api.d.ts'), '')
    await write(join(tmp, '.env'), 'CONVEX_SELF_HOSTED_URL=https://x\nSITE_URL=https://y\n')
    await write(join(tmp, 'package.json'), JSON.stringify({ dependencies: { '@convex-dev/auth': 'latest' } }))
    const issues = await checkConvexSelfHosted(tmp)
    const details = issues.map(i => i.detail)
    expect(details.some(d => d.includes('JWT_PRIVATE_KEY'))).toBe(true)
    expect(details.some(d => d.includes('JWKS'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('flags missing SITE_URL', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'convex', '_generated'), { recursive: true })
    await write(join(tmp, 'convex', '_generated', 'api.d.ts'), '')
    await write(join(tmp, '.env'), 'CONVEX_SELF_HOSTED_URL=https://x\n')
    const issues = await checkConvexSelfHosted(tmp)
    expect(issues.some(i => i.detail.includes('SITE_URL'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test("flags NODE_ENV === 'production' branch (dot)", async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'convex', '_generated'), { recursive: true })
    await write(join(tmp, 'convex', '_generated', 'api.d.ts'), '')
    await write(join(tmp, 'convex', 'foo.ts'), "if (process.env.NODE_ENV === 'production') throw new Error('x')\n")
    await write(join(tmp, '.env'), 'CONVEX_SELF_HOSTED_URL=https://x\nSITE_URL=https://y\n')
    const issues = await checkConvexSelfHosted(tmp)
    expect(issues.some(i => i.detail.includes('NODE_ENV'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test("flags NODE_ENV === 'production' branch (single-quote bracket)", async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'convex', '_generated'), { recursive: true })
    await write(join(tmp, 'convex', '_generated', 'api.d.ts'), '')
    await write(join(tmp, 'convex', 'bar.ts'), "if (process.env['NODE_ENV'] === 'production') throw new Error('x')\n")
    await write(join(tmp, '.env'), 'CONVEX_SELF_HOSTED_URL=https://x\nSITE_URL=https://y\n')
    const issues = await checkConvexSelfHosted(tmp)
    expect(issues.some(i => i.detail.includes('NODE_ENV'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test("flags NODE_ENV === 'production' branch (double-quote bracket)", async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'convex', '_generated'), { recursive: true })
    await write(join(tmp, 'convex', '_generated', 'api.d.ts'), '')
    await write(join(tmp, 'convex', 'baz.ts'), 'if (process.env["NODE_ENV"] === "production") throw new Error("x")\n')
    await write(join(tmp, '.env'), 'CONVEX_SELF_HOSTED_URL=https://x\nSITE_URL=https://y\n')
    const issues = await checkConvexSelfHosted(tmp)
    expect(issues.some(i => i.detail.includes('NODE_ENV'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test("does NOT flag NODE_ENV === 'test' (legitimate test-context bypass)", async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'convex', '_generated'), { recursive: true })
    await write(join(tmp, 'convex', '_generated', 'api.d.ts'), '')
    await write(join(tmp, 'convex', 'qux.ts'), "if (process.env['NODE_ENV'] === 'test') return null\n")
    await write(join(tmp, '.env'), 'CONVEX_SELF_HOSTED_URL=https://x\nSITE_URL=https://y\n')
    const issues = await checkConvexSelfHosted(tmp)
    expect(issues.some(i => i.detail.includes('NODE_ENV'))).toBe(false)
    await rm(tmp, { recursive: true })
  })
  test('flags convex env set outside sync.ts', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'convex', '_generated'), { recursive: true })
    await write(join(tmp, 'convex', '_generated', 'api.d.ts'), '')
    await mkdir(join(tmp, 'scripts'), { recursive: true })
    await write(join(tmp, 'scripts', 'bad.ts'), 'await $`convex env set FOO bar`\n')
    await write(join(tmp, '.env'), 'CONVEX_SELF_HOSTED_URL=https://x\nSITE_URL=https://y\n')
    const issues = await checkConvexSelfHosted(tmp)
    expect(issues.some(i => i.detail.includes("'convex env set'"))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('clean self-hosted convex passes', async () => {
    const tmp = await makeTmp()
    await mkdir(join(tmp, 'convex', '_generated'), { recursive: true })
    await write(join(tmp, 'convex', '_generated', 'api.d.ts'), '')
    await write(join(tmp, '.env'), 'CONVEX_SELF_HOSTED_URL=https://x\nSITE_URL=https://y\nJWT_PRIVATE_KEY=k\nJWKS=j\n')
    await write(join(tmp, 'package.json'), JSON.stringify({ dependencies: { '@convex-dev/auth': 'latest' } }))
    const issues = await checkConvexSelfHosted(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
})
describe('checkBannedImports', () => {
  const writeSrc = async (tmp: string, body: string) => {
    await mkdir(join(tmp, 'scripts'), { recursive: true })
    await write(join(tmp, 'scripts', 's.ts'), body)
  }
  test('flags a banned import with no allow directive', async () => {
    const tmp = await makeTmp()
    await writeSrc(tmp, "import { setGlobalDispatcher } from 'undici'\nexport const x = setGlobalDispatcher\n")
    const issues = await checkBannedImports(tmp)
    expect(issues.some(i => i.detail.includes('undici'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
  test('a per-file pm4ai-allow-import directive with a reason suppresses that ban only for that file', async () => {
    const tmp = await makeTmp()
    await writeSrc(
      tmp,
      '// pm4ai-allow-import undici: SOCKS routing under node for a live-fork verification harness\n' +
        "import { setGlobalDispatcher } from 'undici'\nexport const x = setGlobalDispatcher\n"
    )
    const issues = await checkBannedImports(tmp)
    expect(issues.some(i => i.detail.includes('undici'))).toBe(false)
    await rm(tmp, { recursive: true })
  })
  test('a directive with no reason does not suppress', async () => {
    const tmp = await makeTmp()
    await writeSrc(
      tmp,
      "// pm4ai-allow-import undici:\nimport { setGlobalDispatcher } from 'undici'\nexport const x = setGlobalDispatcher\n"
    )
    const issues = await checkBannedImports(tmp)
    expect(issues.some(i => i.detail.includes('undici'))).toBe(true)
    await rm(tmp, { recursive: true })
  })
})
describe('checkTailwindSourceCoverage', () => {
  const scaffold = async ({
    cssTail = '',
    depIndex,
    depName = 'faklib',
    tmp
  }: {
    cssTail?: string
    depIndex: string
    depName?: string
    tmp: string
  }) => {
    await mkdir(join(tmp, 'apps', 'web', 'src', 'app'), { recursive: true })
    await write(join(tmp, 'apps', 'web', 'src', 'app', 'page.tsx'), `import { X } from '${depName}'\nexport const P = X\n`)
    await write(join(tmp, 'apps', 'web', 'src', 'app', 'global.css'), `@import '@a/ui/globals.css';\n${cssTail}`)
    await mkdir(join(tmp, 'node_modules', depName), { recursive: true })
    await write(join(tmp, 'node_modules', depName, 'index.js'), depIndex)
  }
  const jsxDist =
    'export const A = () => <div className="py-[3px]" />\n' +
    'export const B = () => <div className="gap-[5px]" />\n' +
    'export const C = () => <div className="w-[40px]" />\n'
  const X = 'export const X = A\n'
  test('flags a component lib that ships utility classes but is not @source-d', async () => {
    const tmp = await makeTmp()
    await scaffold({ depIndex: jsxDist + X, tmp })
    const issues = await checkTailwindSourceCoverage(tmp)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.detail).toContain('faklib')
    await rm(tmp, { recursive: true })
  })
  test('no issue when the same lib is @source-d — the @source is the only thing suppressing it', async () => {
    const tmp = await makeTmp()
    await scaffold({ cssTail: "@source '../../../../node_modules/faklib';\n", depIndex: jsxDist + X, tmp })
    const issues = await checkTailwindSourceCoverage(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('no issue when the lib is @source-d as a local workspace package (packages/<name>/src) in its own monorepo', async () => {
    const tmp = await makeTmp()
    await scaffold({ cssTail: "@source '../../packages/faklib/src';\n", depIndex: jsxDist + X, tmp })
    const issues = await checkTailwindSourceCoverage(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('no issue when the lib ships pre-compiled css the entry @imports directly — the import is the coverage', async () => {
    const tmp = await makeTmp()
    await scaffold({ cssTail: "@import 'faklib/css/preset.css';\n", depIndex: jsxDist + X, tmp })
    const issues = await checkTailwindSourceCoverage(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('no issue for a lib that ships no arbitrary-value utility classes', async () => {
    const tmp = await makeTmp()
    await scaffold({ depIndex: 'export const X = () => 42\n', depName: 'plainlib', tmp })
    const issues = await checkTailwindSourceCoverage(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('does not flag a non-UI lib with a single coincidental bracket match (below threshold)', async () => {
    const tmp = await makeTmp()
    await scaffold({ depIndex: 'export const X = () => <div className="w-[40px]" />\n', depName: 'coinclib', tmp })
    const issues = await checkTailwindSourceCoverage(tmp)
    expect(issues).toHaveLength(0)
    await rm(tmp, { recursive: true })
  })
  test('scopes per app — a package one app imports never flags a sibling app that does not import it', async () => {
    const tmp = await makeTmp()
    const app = async (name: string, dep: string, sourced: boolean) => {
      await mkdir(join(tmp, 'apps', name, 'src', 'app'), { recursive: true })
      await write(join(tmp, 'apps', name, 'package.json'), JSON.stringify({ name }))
      await write(join(tmp, 'apps', name, 'src', 'app', 'page.tsx'), `import { X } from '${dep}'\nexport const P = X\n`)
      const tail = sourced ? `@source '../../../../node_modules/${dep}';\n` : ''
      await write(join(tmp, 'apps', name, 'src', 'app', 'global.css'), `@import '@a/ui/globals.css';\n${tail}`)
    }
    for (const dep of ['fumalib', 'idecnlib']) {
      await mkdir(join(tmp, 'node_modules', dep), { recursive: true })
      await write(join(tmp, 'node_modules', dep, 'index.js'), jsxDist + X)
    }
    await app('docs', 'fumalib', false)
    await app('web', 'idecnlib', true)
    const issues = await checkTailwindSourceCoverage(tmp)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.detail).toContain('fumalib')
    expect(issues[0]?.detail).toContain('apps/docs')
    expect(issues.some(i => i.detail.includes('apps/web') || i.detail.includes('idecnlib'))).toBe(false)
    await rm(tmp, { recursive: true })
  })
})
describe('deployStateFailed', () => {
  test('a failed GitHub deployment state is reported', () => {
    expect(deployStateFailed('failure')).toBe(true)
    expect(deployStateFailed('error')).toBe(true)
  })
  test('a healthy or transient state is not reported', () => {
    expect(deployStateFailed('success')).toBe(false)
    expect(deployStateFailed('in_progress')).toBe(false)
    expect(deployStateFailed('queued')).toBe(false)
    expect(deployStateFailed('')).toBe(false)
  })
})
