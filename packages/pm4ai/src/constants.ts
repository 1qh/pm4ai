import { readFileSync } from 'node:fs'
import { join } from 'node:path'
interface PkgJson {
  license?: string
  name?: string
  requiredDevDeps?: string[]
}
const selfPkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as PkgJson
const PKG_NAME = selfPkg.name ?? 'pm4ai'
const DEFAULT_LICENSE = selfPkg.license ?? 'MIT'
const LINTMAX_PKG = 'lintmax'
const TSDOWN_BASE = {
  clean: true,
  deps: { neverBundle: ['bun'] },
  dts: true,
  format: 'esm' as const,
  outDir: 'dist'
}
const DEFAULT_FILES = [TSDOWN_BASE.outDir]
const REQUIRED_ROOT_DEVDEPS = (selfPkg as { requiredDevDeps?: string[] }).requiredDevDeps ?? []
const DEFAULT_DEP_VERSION = 'latest'
const CLAUDE_MD = 'CLAUDE.md'
const CONFIG_DIR = '.pm4ai'
const EXPECTED = {
  preCommit: 'sh up.sh && git add -u',
  prepare: 'bunx simple-git-hooks',
  tsconfigExtends: `${LINTMAX_PKG}/tsconfig`,
  vercelInstall: 'bun i'
}
const DEFAULT_SCRIPTS = {
  build: 'turbo build --output-logs=errors-only',
  check: `${LINTMAX_PKG} check`,
  clean: 'sh clean.sh',
  fix: `${LINTMAX_PKG} fix`,
  postinstall: 'sherif',
  prepare: EXPECTED.prepare
}
const FORBIDDEN_LOCKFILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.npmrc', '.yarnrc', '.yarnrc.yml']
const FORBIDDEN_PM_PREFIXES = ['npm ', 'npx ', 'yarn ', 'pnpm ']
const GH_ORG = '1qh'
const MONOREPO_NAME = 'pm4ai-monorepo'
const MUST_EXIST_FILES = ['turbo.json', 'tsconfig.json', 'postcss.config.ts', '.github/workflows/ci.yml']
const SWIFTBAR_FONT = '| font=Menlo size=13'
const READONLY_UI = 'readonly/ui'
const UI_PACKAGE_NAME = '@a/ui'
const RG_EXCLUDE_DIRS = ['node_modules', 'readonly', '.next', 'dist', '_generated', 'generated']
const RG_EXCLUDE_FILES = ['banned.ts']
const RG_EXCLUDE = [...RG_EXCLUDE_DIRS.flatMap(d => ['-g', `!${d}`]), ...RG_EXCLUDE_FILES.flatMap(f => ['-g', `!**/${f}`])]
const SKIP_PATTERNS = ['/readonly/', '/.next/']
const TURBO_FLAG = '--output-logs=errors-only'
const VERBATIM_FILES = ['.github/workflows/ci.yml', 'clean.sh', 'up.sh', 'bunfig.toml', '.gitignore', 'postcss.config.ts']
export {
  CLAUDE_MD,
  CONFIG_DIR,
  DEFAULT_DEP_VERSION,
  DEFAULT_FILES,
  DEFAULT_LICENSE,
  DEFAULT_SCRIPTS,
  EXPECTED,
  FORBIDDEN_LOCKFILES,
  FORBIDDEN_PM_PREFIXES,
  GH_ORG,
  LINTMAX_PKG,
  MONOREPO_NAME,
  MUST_EXIST_FILES,
  PKG_NAME,
  READONLY_UI,
  REQUIRED_ROOT_DEVDEPS,
  RG_EXCLUDE,
  SKIP_PATTERNS,
  SWIFTBAR_FONT,
  TSDOWN_BASE,
  TURBO_FLAG,
  UI_PACKAGE_NAME,
  VERBATIM_FILES
}
