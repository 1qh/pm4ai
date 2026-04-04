const VERBATIM_FILES = ['clean.sh', 'up.sh', 'bunfig.toml', '.gitignore']
const MUST_EXIST_FILES = ['turbo.json', 'tsconfig.json', '.github/workflows/ci.yml']
const FORBIDDEN_LOCKFILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.npmrc', '.yarnrc', '.yarnrc.yml']
const FORBIDDEN_PM_PREFIXES = ['npm ', 'npx ', 'yarn ', 'pnpm ']
const SKIP_PATTERNS = ['/readonly/', '/.next/']
const EXPECTED = {
  preCommit: 'sh up.sh && git add -u',
  prepare: 'bunx simple-git-hooks',
  tsconfigExtends: 'lintmax/tsconfig',
  vercelInstall: 'bun i'
}
const TURBO_FLAG = '--output-logs=errors-only'
export {
  EXPECTED,
  FORBIDDEN_LOCKFILES,
  FORBIDDEN_PM_PREFIXES,
  MUST_EXIST_FILES,
  SKIP_PATTERNS,
  TURBO_FLAG,
  VERBATIM_FILES
}
