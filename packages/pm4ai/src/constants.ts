import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
interface PkgJson {
  license?: string
  name?: string
  requiredDevDeps?: string[]
}
/** biome-ignore lint/nursery/noUnsafeTypeAssertion: own package.json read into the known PkgJson shape — single boundary, kept inline so the build config loader stays dependency-free */
const selfPkg = JSON.parse(await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as PkgJson
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
const REQUIRED_ROOT_DEVDEPS = selfPkg.requiredDevDeps ?? []
const DEFAULT_DEP_VERSION = 'latest'
const CLAUDE_MD = 'CLAUDE.md'
const EXPECTED = {
  preCommit: 'sh up.sh && git add -u',
  prepare: 'bunx simple-git-hooks',
  tsconfigExtends: `${LINTMAX_PKG}/tsconfig`,
  vercelInstall: 'bun i'
}
const TURBO_FLAG = '--output-logs=errors-only'
const TURBO_WARNING_FILTER = 'WARNING|Could not resolve workspaces?|missing field|Turborepo will still function'
const filterTurboWorkspaceWarning = (cmd: string): string =>
  `bash -c "${cmd} 2> >(grep -vE '${TURBO_WARNING_FILTER}' >&2)"`
const DEFAULT_SCRIPTS = {
  build: filterTurboWorkspaceWarning(`turbo build ${TURBO_FLAG}`),
  check: `${LINTMAX_PKG} check`,
  clean: 'sh clean.sh',
  fix: `${LINTMAX_PKG} fix`,
  postinstall: 'sherif -i typescript',
  prepare: EXPECTED.prepare
}
const FORBIDDEN_LOCKFILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.npmrc', '.yarnrc', '.yarnrc.yml']
const FORBIDDEN_PM_PREFIXES = ['npm ', 'npx ', 'yarn ', 'pnpm ']
const GH_ORG = '1qh'
const MONOREPO_NAME = 'pm4ai-monorepo'
const MUST_EXIST_FILES = ['turbo.json', 'tsconfig.json']
const SWIFTBAR_FONT = '| font=Menlo size=13'
const READONLY_UI = 'readonly/ui'
const UI_PACKAGE_NAME = '@a/ui'
const RG_EXCLUDE_DIRS = ['node_modules', 'readonly', '.next', 'dist', '_generated', 'generated']
const RG_EXCLUDE_FILES = ['banned.ts']
const RG_EXCLUDE = [...RG_EXCLUDE_DIRS.flatMap(d => ['-g', `!${d}`]), ...RG_EXCLUDE_FILES.flatMap(f => ['-g', `!**/${f}`])]
const FUMADOCS_DARK_CSS = `.dark {
  --color-fd-background: hsl(0, 0%, 0%);
  --color-fd-card: hsl(0, 0%, 5%);
  --color-fd-popover: hsl(0, 0%, 5%);
  --color-fd-muted: hsl(0, 0%, 8%);
  --color-fd-secondary: hsl(0, 0%, 8%);
  --color-fd-border: hsla(0, 0%, 30%, 30%);
}
.font-mono,
pre,
code {
  font-family: var(--font-mono), ui-monospace, monospace;
}
html {
  scrollbar-gutter: stable;
}
html > body[data-scroll-locked] {
  margin-right: 0px !important;
}`
const SKIP_PATTERNS = ['/readonly/', '/.next/']
const VERBATIM_FILES = ['clean.sh', 'up.sh', 'bunfig.toml', '.gitignore']
/** A purely additive list, so a consumer's own ignores append after the canonical head — unlike the executable canon of clean.sh/up.sh, which admits no local edit. */
const EXTENDABLE_VERBATIM_FILES = new Set(['.gitignore'])
interface ConditionalFile {
  extendable?: boolean
  path: string
  when: 'fumadocs' | 'github' | 'publishable' | 'tailwind'
}
const CONDITIONAL_VERBATIM_FILES: ConditionalFile[] = [
  { extendable: true, path: '.github/workflows/ci.yml', when: 'github' },
  { path: '.github/scripts/prune-ci-runs.sh', when: 'github' },
  { path: 'postcss.config.ts', when: 'tailwind' },
  { path: 'apps/docs/src/app/global.css', when: 'fumadocs' },
  { path: 'tools/prune-versions.ts', when: 'publishable' },
  { path: 'tools/release.ts', when: 'publishable' },
  { path: '.github/workflows/release.yml', when: 'publishable' }
]
const CONDITIONAL_MUST_EXIST_FILES: ConditionalFile[] = [
  { path: 'postcss.config.ts', when: 'tailwind' },
  { path: '.github/workflows/ci.yml', when: 'github' },
  { path: '.github/workflows/release.yml', when: 'publishable' }
]
export {
  CLAUDE_MD,
  CONDITIONAL_MUST_EXIST_FILES,
  CONDITIONAL_VERBATIM_FILES,
  DEFAULT_DEP_VERSION,
  DEFAULT_FILES,
  DEFAULT_LICENSE,
  DEFAULT_SCRIPTS,
  EXPECTED,
  EXTENDABLE_VERBATIM_FILES,
  filterTurboWorkspaceWarning,
  FORBIDDEN_LOCKFILES,
  FORBIDDEN_PM_PREFIXES,
  FUMADOCS_DARK_CSS,
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
  TURBO_WARNING_FILTER,
  UI_PACKAGE_NAME,
  VERBATIM_FILES
}
export type { ConditionalFile }
