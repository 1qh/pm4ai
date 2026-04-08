/** biome-ignore-all lint/style/noProcessEnv: CI detection */
import { $ } from 'bun'
import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SCRIPTS, EXPECTED, REQUIRED_ROOT_DEVDEPS, REQUIRED_TRUSTED_DEPS } from '../constants.js'
import { init } from '../init.js'
const TEST_NAME = `pm4ai-init-${Date.now()}`
const TEST_DIR = join(tmpdir(), TEST_NAME)
const providerJsxRe = /<\w+Provider/u
const readPkg = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
afterAll(() => rmSync(TEST_DIR, { force: true, recursive: true }))
describe('init scaffold', () => {
  test('creates project', async () => {
    process.chdir(tmpdir())
    await init(TEST_NAME)
    expect(existsSync(TEST_DIR)).toBe(true)
  }, 30_000)
  test('has all required structure', () => {
    const must = [
      'CLAUDE.md',
      'package.json',
      'turbo.json',
      'tsconfig.json',
      'bunfig.toml',
      'clean.sh',
      'up.sh',
      '.gitignore',
      '.github/workflows/ci.yml',
      'lintmax.config.ts',
      'apps/web/package.json',
      'apps/web/src/app/page.tsx',
      'apps/web/src/app/layout.tsx',
      'apps/web/src/app/fonts.ts',
      'apps/web/src/app/globals.css',
      'apps/web/src/lib/providers.tsx',
      'apps/web/postcss.config.ts',
      'apps/docs/package.json',
      'apps/docs/source.config.ts',
      'apps/docs/content/docs/index.mdx',
      'apps/docs/src/app/layout.tsx',
      'apps/docs/src/app/(home)/page.tsx',
      'apps/docs/src/app/docs/layout.tsx',
      'apps/docs/src/app/docs/[[...slug]]/page.tsx',
      'apps/docs/src/lib/source.ts',
      'apps/docs/src/components/mdx.tsx',
      'packages/cli/package.json',
      'packages/cli/tsdown.config.ts',
      'packages/cli/src/cli.ts',
      'packages/cli/src/index.ts',
      'packages/cli/src/tui.tsx',
      'packages/lib/package.json',
      'packages/lib/tsdown.config.ts',
      'packages/lib/src/index.ts',
      'readonly/ui/package.json',
      '.git'
    ]
    for (const f of must) expect(existsSync(join(TEST_DIR, f))).toBe(true)
  })
  test('has no pm4ai-specific files', () => {
    const forbidden = [
      'vercel.json',
      'prompts',
      'apps/web/src/lib/router.ts',
      'apps/web/src/lib/socket.ts',
      'apps/web/src/lib/auth.ts',
      'apps/web/src/lib/client.ts',
      'apps/web/src/app/api',
      'apps/web/src/app/auth',
      'apps/web/src/tests',
      'apps/docs/content/rules',
      'apps/docs/src/app/llms-full.txt',
      'apps/docs/src/app/api',
      'packages/pm4ai'
    ]
    for (const f of forbidden) expect(existsSync(join(TEST_DIR, f))).toBe(false)
  })
  test('package names are correct', () => {
    const rootPkg = readPkg(join(TEST_DIR, 'package.json'))
    expect(rootPkg.name).toBeUndefined()
    expect(rootPkg.private).toBe(true)
    const cliPkg = readPkg(join(TEST_DIR, 'packages/cli/package.json'))
    expect(cliPkg.name).toBe(TEST_NAME)
    const bin = cliPkg.bin as Record<string, string>
    expect(bin[TEST_NAME]).toBe('dist/cli.mjs')
    const libPkg = readPkg(join(TEST_DIR, 'packages/lib/package.json'))
    expect(libPkg.name).toBe(`@${TEST_NAME}/lib`)
  })
  test('no pm4ai-specific deps', () => {
    const webPkg = readPkg(join(TEST_DIR, 'apps/web/package.json'))
    const webDeps = (webPkg.dependencies ?? {}) as Record<string, string>
    expect(webDeps.pm4ai).toBeUndefined()
    expect(webDeps['@orpc/client']).toBeUndefined()
    expect(webDeps.zod).toBeUndefined()
    const docsPkg = readPkg(join(TEST_DIR, 'apps/docs/package.json'))
    const docsDeps = (docsPkg.dependencies ?? {}) as Record<string, string>
    expect(docsDeps.pm4ai).toBeUndefined()
  })
  test('no Provider in layout files', () => {
    const webLayout = readFileSync(join(TEST_DIR, 'apps/web/src/app/layout.tsx'), 'utf8')
    expect(webLayout).not.toMatch(providerJsxRe)
    expect(webLayout).toContain('Providers')
  })
  test('docs uses content/docs path', () => {
    const sourceConfig = readFileSync(join(TEST_DIR, 'apps/docs/source.config.ts'), 'utf8')
    expect(sourceConfig).toContain("'content/docs'")
  })
  test('template root package.json matches constants', () => {
    const tplPkg = readPkg(join(TEST_DIR, 'package.json'))
    const scripts = tplPkg.scripts as Record<string, string>
    for (const [key, val] of Object.entries(DEFAULT_SCRIPTS)) expect(scripts[key]).toBe(val)
    const hooks = tplPkg['simple-git-hooks'] as Record<string, string>
    expect(hooks['pre-commit']).toBe(EXPECTED.preCommit)
    const devDeps = Object.keys(tplPkg.devDependencies as Record<string, string>)
    for (const dep of REQUIRED_ROOT_DEVDEPS) expect(devDeps).toContain(dep)
    const trusted = tplPkg.trustedDependencies as string[]
    for (const dep of REQUIRED_TRUSTED_DEPS) expect(trusted).toContain(dep)
    expect(tplPkg.private).toBe(true)
    expect(tplPkg.name).toBeUndefined()
  })
  test.skipIf(!process.env.CI)(
    'bun install succeeds',
    async () => {
      const result = await $`bun i`.cwd(TEST_DIR).quiet().nothrow()
      expect(result.exitCode).toBe(0)
    },
    60_000
  )
  test.skipIf(!process.env.CI)(
    'build succeeds',
    async () => {
      const result = await $`bun run build`.cwd(TEST_DIR).quiet().nothrow()
      expect(result.exitCode).toBe(0)
    },
    120_000
  )
  test.skipIf(!process.env.CI)(
    'fix produces no changes',
    async () => {
      const result = await $`bun run fix`.cwd(TEST_DIR).quiet().nothrow()
      expect(result.exitCode).toBe(0)
      const status = await $`git status --porcelain`.cwd(TEST_DIR).quiet().nothrow()
      expect(status.stdout.toString().trim()).toBe('')
    },
    120_000
  )
  test.skipIf(!process.env.CI)(
    'status has no issues',
    async () => {
      const result = await $`bunx pm4ai@latest status`.cwd(TEST_DIR).quiet().nothrow()
      const output = result.stdout.toString()
      expect(output).not.toContain('forbidden')
      expect(output).not.toContain('missing')
      expect(output).not.toContain('drift')
    },
    120_000
  )
})
