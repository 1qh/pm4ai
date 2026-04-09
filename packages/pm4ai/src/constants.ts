const CLAUDE_MD = 'CLAUDE.md'
const EXPECTED = {
  preCommit: 'sh up.sh && git add -u',
  prepare: 'bunx simple-git-hooks',
  tsconfigExtends: 'lintmax/tsconfig',
  vercelInstall: 'bun i'
}
const FORBIDDEN_LOCKFILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.npmrc', '.yarnrc', '.yarnrc.yml']
const FORBIDDEN_PM_PREFIXES = ['npm ', 'npx ', 'yarn ', 'pnpm ']
const GH_ORG = '1qh'
const LINTMAX_PKG = 'lintmax'
const MONOREPO_NAME = 'pm4ai-monorepo'
const MUST_EXIST_FILES = ['turbo.json', 'tsconfig.json', 'postcss.config.ts', '.github/workflows/ci.yml']
const CONFIG_DIR = '.pm4ai'
const PKG_NAME = 'pm4ai'
const SWIFTBAR_FONT = '| font=Menlo size=13'
const READONLY_UI = 'readonly/ui'
const UI_PACKAGE_NAME = '@a/ui'
const RG_EXCLUDE_DIRS = ['node_modules', 'readonly', '.next', 'dist', '_generated', 'generated']
const RG_EXCLUDE_FILES = ['banned.ts']
const RG_EXCLUDE = [...RG_EXCLUDE_DIRS.flatMap(d => ['-g', `!${d}`]), ...RG_EXCLUDE_FILES.flatMap(f => ['-g', `!**/${f}`])]
const SKIP_PATTERNS = ['/readonly/', '/.next/']
const REQUIRED_ROOT_DEVDEPS = ['lintmax', 'sherif', 'simple-git-hooks', 'tsdown', 'turbo', 'typescript']
const REQUIRED_TRUSTED_DEPS = ['esbuild', 'lintmax', 'simple-git-hooks']
const DEFAULT_DEP_VERSION = 'latest'
const DEFAULT_FILES = ['dist']
const DEFAULT_LICENSE = 'MIT'
const DEFAULT_SCRIPTS = {
  build: 'turbo build --output-logs=errors-only',
  check: 'lintmax check',
  clean: 'sh clean.sh',
  fix: 'lintmax fix',
  postinstall: 'sherif',
  prepare: 'bunx simple-git-hooks'
}
const CLEANUP_SCRIPT = {
  dir: 'script',
  name: 'cleanup-old-versions.ts',
  postpublish: 'bun run cleanup-old-versions',
  task: 'cleanup-old-versions'
}
const TURBO_FLAG = '--output-logs=errors-only'
const VERBATIM_FILES = ['.github/workflows/ci.yml', 'clean.sh', 'up.sh', 'bunfig.toml', '.gitignore', 'postcss.config.ts']
export {
  CLAUDE_MD,
  CLEANUP_SCRIPT,
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
  REQUIRED_TRUSTED_DEPS,
  RG_EXCLUDE,
  SKIP_PATTERNS,
  SWIFTBAR_FONT,
  TURBO_FLAG,
  UI_PACKAGE_NAME,
  VERBATIM_FILES
}
