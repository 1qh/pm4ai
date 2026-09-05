/** biome-ignore-all lint/suspicious/noMisplacedAssertion: the rule recognises test(name, fn) but not the test.skipIf(cond)(name, fn) call form, so it reads every assertion in these blocks as sitting outside a test */
import { $, file } from 'bun'
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkSherifScope, checkTypescriptPin } from '../checks.js'
import { DEFAULT_SCRIPTS, EXPECTED, REQUIRED_ROOT_DEVDEPS } from '../constants.js'
import { init } from '../init.js'
import { parseJson } from '../json.js'

setDefaultTimeout(30_000)
const dirExists = async (p: string): Promise<boolean> => {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}
const pathExists = async (p: string): Promise<boolean> => {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}
const TEST_NAME = `pm4ai-init-${Date.now()}`
const TEST_DIR = join(tmpdir(), TEST_NAME)
const providerJsxRe = /<\w+Provider/u
interface FixturePackage {
  bin?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  name?: string
  private?: boolean
  scripts?: Record<string, string>
  'simple-git-hooks'?: Record<string, string>
  trustedDependencies?: string[]
}
const readPkg = async (path: string): Promise<FixturePackage> => parseJson<FixturePackage>(await file(path).text())
process.env.PM4AI_SKIP_BOOK_WIRING = '1'
afterAll(async () => {
  delete process.env.PM4AI_SKIP_BOOK_WIRING
  await rm(TEST_DIR, { force: true, recursive: true })
}, 60_000)
describe('init scaffold', () => {
  test('creates project', async () => {
    process.chdir(tmpdir())
    await init(TEST_NAME)
    expect(await dirExists(TEST_DIR)).toBe(true)
  }, 30_000)
  test('has all required structure', async () => {
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
      'apps/web/package.json',
      'apps/web/src/app/page.tsx',
      'apps/web/src/app/layout.tsx',
      'apps/web/src/app/fonts.ts',
      'apps/web/src/app/global.css',
      'apps/web/src/app/providers.tsx',
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
    await Promise.all(must.map(async f => expect(await pathExists(join(TEST_DIR, f))).toBe(true)))
  })
  test('has no pm4ai-specific files', async () => {
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
    await Promise.all(forbidden.map(async f => expect(await pathExists(join(TEST_DIR, f))).toBe(false)))
  })
  test('package names are correct', async () => {
    const rootPkg = await readPkg(join(TEST_DIR, 'package.json'))
    expect(rootPkg.name).toBeUndefined()
    expect(rootPkg.private).toBe(true)
    const cliPkg = await readPkg(join(TEST_DIR, 'packages/cli/package.json'))
    expect(cliPkg.name).toBe(TEST_NAME)
    const bin = cliPkg.bin ?? {}
    expect(bin[TEST_NAME]).toBe('dist/cli.mjs')
    const libPkg = await readPkg(join(TEST_DIR, 'packages/lib/package.json'))
    expect(libPkg.name).toBe(`@${TEST_NAME}/lib`)
  })
  test('no pm4ai-specific deps', async () => {
    const webPkg = await readPkg(join(TEST_DIR, 'apps/web/package.json'))
    const webDeps = webPkg.dependencies ?? {}
    expect(webDeps.pm4ai).toBeUndefined()
    expect(webDeps['@orpc/client']).toBeUndefined()
    expect(webDeps.zod).toBeUndefined()
    const docsPkg = await readPkg(join(TEST_DIR, 'apps/docs/package.json'))
    const docsDeps = docsPkg.dependencies ?? {}
    expect(docsDeps.pm4ai).toBeUndefined()
  })
  test('no Provider in layout files', async () => {
    const webLayout = await file(join(TEST_DIR, 'apps/web/src/app/layout.tsx')).text()
    expect(webLayout).not.toMatch(providerJsxRe)
    expect(webLayout).toContain('Providers')
  })
  test('docs uses content/docs path', async () => {
    const sourceConfig = await file(join(TEST_DIR, 'apps/docs/source.config.ts')).text()
    expect(sourceConfig).toContain("'content/docs'")
  })
  test('docs global css scans workspace package sources', async () => {
    const globalCss = await file(join(TEST_DIR, 'apps/docs/src/app/global.css')).text()
    expect(globalCss).toContain("@source '../../../../packages/**/*.{ts,tsx}';")
  })
  test('template root package.json matches constants', async () => {
    const tplPkg = await readPkg(join(TEST_DIR, 'package.json'))
    const scripts = tplPkg.scripts ?? {}
    for (const [key, val] of Object.entries(DEFAULT_SCRIPTS)) expect(scripts[key]).toBe(val)
    const hooks = tplPkg['simple-git-hooks'] ?? {}
    expect(hooks['pre-commit']).toBe(EXPECTED.preCommit)
    const devDeps = Object.keys(tplPkg.devDependencies ?? {})
    for (const dep of REQUIRED_ROOT_DEVDEPS) expect(devDeps).toContain(dep)
    const rootPkg = await readPkg(join(import.meta.dirname, '..', '..', '..', '..', 'package.json'))
    const trusted = tplPkg.trustedDependencies ?? []
    for (const dep of rootPkg.trustedDependencies ?? []) expect(trusted).toContain(dep)
    expect(tplPkg.private).toBe(true)
    expect(tplPkg.name).toBeUndefined()
  })
  test('scaffold satisfies the checks the manager enforces on every managed repo', async () => {
    expect(await checkTypescriptPin(TEST_DIR)).toEqual([])
    expect(await checkSherifScope(TEST_DIR)).toEqual([])
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
    'lintmax fix produces no changes',
    async () => {
      const result = await $`bun run fix`.cwd(TEST_DIR).quiet().nothrow()
      expect(result.exitCode).toBe(0)
      const status = await $`git status --porcelain -- .`.cwd(TEST_DIR).quiet().nothrow()
      expect(status.stdout.toString().trim()).toBe('')
    },
    120_000
  )
})
