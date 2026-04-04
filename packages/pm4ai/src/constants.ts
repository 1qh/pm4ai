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
const MUST_EXIST_FILES = ['turbo.json', 'tsconfig.json', '.github/workflows/ci.yml']
const PKG_NAME = 'pm4ai'
const READONLY_UI = 'readonly/ui'
const SKIP_PATTERNS = ['/readonly/', '/.next/']
const REQUIRED_ROOT_DEVDEPS = ['@types/bun', 'lintmax', 'sherif', 'simple-git-hooks', 'turbo', 'typescript']
const REQUIRED_TRUSTED_DEPS = ['lintmax']
const TURBO_FLAG = '--output-logs=errors-only'
const VERBATIM_FILES = ['clean.sh', 'up.sh', 'bunfig.toml', '.gitignore']
export {
  CLAUDE_MD,
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
  SKIP_PATTERNS,
  TURBO_FLAG,
  VERBATIM_FILES
}
