import { $, env, file, Glob, spawn, write } from 'bun'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Issue, IssueType, PackageJson } from './types.js'
import { ALL_BANNED, BUN_GLOBALS, LINTMAX_ONLY, TEMPORARY, TEMPORARY_ALLOWED_PACKAGES } from './banned.js'
import {
  CONDITIONAL_MUST_EXIST_FILES,
  DEFAULT_SCRIPTS,
  EXPECTED,
  FORBIDDEN_LOCKFILES,
  MUST_EXIST_FILES,
  READONLY_UI,
  RG_EXCLUDE,
  UI_PACKAGE_NAME
} from './constants.js'
import { parseJson } from './json.js'
import {
  debug,
  detectCapabilities,
  getGhRepo,
  getTsconfigTypes,
  isExtended,
  isNestedInRepo,
  readJson,
  readPkg,
  rel,
  resolveManagedFiles
} from './utils.js'
const SCAN_EXCLUDE = new Set(['.git', '.next', '.turbo', '.vercel', 'dist', 'node_modules', 'readonly', 'templates'])
interface TsconfigCompilerOptions {
  paths?: Record<string, string[]>
}
const glob = async (pattern: string, cwd: string): Promise<string[]> => {
  const results: string[] = []
  const isDot = pattern.includes('/.')
  const scanned = new Glob(pattern).scan({ cwd, dot: isDot, onlyFiles: true })
  for await (const f of scanned) if (f.split('/').every(seg => !SCAN_EXCLUDE.has(seg))) results.push(join(cwd, f))
  return results
}
const doesPathExist = async (p: string): Promise<boolean> => {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}
const shell = async (projectPath: string, ...args: string[]) => {
  const proc = spawn(['rg', ...args, projectPath, '-g', '*.ts', '-g', '*.tsx', ...RG_EXCLUDE, '-l'], {
    env,
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: 15_000
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ])
  if (proc.signalCode || (exitCode !== 0 && exitCode !== 1))
    throw new Error(`rg failed (${proc.signalCode ?? exitCode}): ${stderr.trim()}`)
  return stdout.trim()
}
const importPattern = (ban: string): string => {
  const isExact = ban.endsWith('"')
  const name = ban.replaceAll(/^"|"$/gu, '').replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
  const quote = isExact ? `['"]` : ''
  return `(from|import|require)[\\s(]+['"]${name}${quote}`
}
const importSpecifierPattern = (ban: string): RegExp => {
  const isExact = ban.endsWith('"')
  const name = ban.replaceAll(/^"|"$/gu, '').replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
  const tail = isExact ? '' : `[^'"]*`
  return new RegExp(`(?:from|import|require)[\\s(]+['"](${name}${tail})['"]`, 'gu')
}
const temporaryAllowedPackages = (ban: string): readonly string[] => TEMPORARY_ALLOWED_PACKAGES[ban] ?? []
const isTemporarilyAllowedPackage = (ban: string, packageName: string): boolean =>
  temporaryAllowedPackages(ban).includes(packageName)
const hasAllowDirective = (content: string, ban: string): boolean => {
  const clean = ban.replaceAll(/^"|"$/gu, '').replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
  return new RegExp(String.raw`pm4ai-allow-import[ \t]+${clean}[ \t]*:[ \t]*\S`, 'u').exec(content) !== null
}
const hasBlockedImport = (content: string, ban: string): boolean => {
  if (hasAllowDirective(content, ban)) return false
  const matches = content.matchAll(importSpecifierPattern(ban))
  for (const match of matches) {
    const packageName = match[1]
    if (packageName !== undefined && !isTemporarilyAllowedPackage(ban, packageName)) return true
  }
  return false
}
const readSources = async (files: string, cache: Map<string, string>): Promise<Map<string, string>> => {
  const entries = await Promise.all(
    files
      .split('\n')
      .filter(Boolean)
      .map(async path => {
        const content = cache.get(path) ?? (await file(path).text())
        cache.set(path, content)
        return [path, content] as const
      })
  )
  return new Map(entries)
}
const bannedImportFiles = async (projectPath: string, patterns: string[]): Promise<string> => {
  const tmp = await mkdtemp(join(tmpdir(), 'pm4ai-imports-'))
  try {
    const path = join(tmp, 'patterns')
    await write(path, patterns.join('\n'))
    return await shell(projectPath, '-f', path)
  } finally {
    await rm(tmp, { recursive: true })
  }
}
const relList = (files: string, base: string) =>
  files
    .split('\n')
    .map(f => rel(f, base))
    .join(', ')
const issue = (type: IssueType, detail: string): Issue => ({ detail, type })
const drift = (detail: string) => issue('drift', detail)
const forbidden = (detail: string) => issue('forbidden', detail)
const providerJsxRe = /<\w+Provider/gu
const serverProviderRe = /<\w*Server\w*Provider/u
const providerImportRe = /from\s+['"].*providers/u
interface CiRun {
  conclusion: null | string
  createdAt: string
  status: string
}
const latestRunIssue = (latest: CiRun | undefined): Issue => {
  if (!latest) return issue('ci', 'CI: no runs')
  if (latest.status !== 'completed') return issue('info', `CI ${latest.status} ${latest.createdAt}`)
  if (latest.conclusion === 'success') return issue('info', `CI passed ${latest.createdAt}`)
  return issue('ci', `CI ${latest.conclusion ?? 'incomplete'} ${latest.createdAt}`)
}
const ciHistoryIssues = (count: number): Issue[] => {
  if (count === 1) return [issue('info', 'CI history clean (1 run)')]
  if (count > 1) return [issue('ci', `CI history not clean: ${count}${count >= 100 ? '+' : ''} runs`)]
  return []
}
const checkCi = async (projectPath: string): Promise<Issue[]> => {
  const repo = await getGhRepo(projectPath)
  if (!repo) return []
  const result = await $`gh run list --repo ${repo} --workflow ci.yml --limit 100 --json conclusion,status,createdAt`
    .quiet()
    .nothrow()
  if (result.exitCode !== 0) {
    debug('command failed:', `gh run list --repo ${repo}`)
    return []
  }
  const runs = parseJson<CiRun[]>(result.stdout.toString().trim() || '[]')
  return [latestRunIssue(runs.at(0)), ...ciHistoryIssues(runs.length)]
}
const missingVarIssues = async (repo: string): Promise<Issue[]> => {
  const vars = await $`gh api repos/${repo}/actions/variables --jq '.variables[].name'`.quiet().nothrow()
  if (vars.exitCode !== 0) {
    debug('command failed:', `gh api repos/${repo}/actions/variables`)
    return []
  }
  const names = new Set(vars.stdout.toString().trim().split('\n').filter(Boolean))
  return [
    ...(names.has('RUNNER_LABEL') ? [] : [issue('ci', 'missing RUNNER_LABEL var')]),
    ...(names.has('NTFY_TOPIC') ? [] : [issue('ci', 'missing NTFY_TOPIC var')])
  ]
}
const RUNS_ON_KEY = 'runs-on:'
const runsOnValues = (content: string): string[] => {
  const values: string[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith(RUNS_ON_KEY)) values.push(trimmed.slice(RUNS_ON_KEY.length))
  }
  return values
}
const HOSTED_RUNNER_RE = /(?<![\w.-])(?:ubuntu|windows|macos)-[\w.-]+/gu
const WORKFLOW_EXTENSION_RE = /\.ya?ml$/u
const hostedRunnerFileIssues = async (workflowPath: string, projectPath: string): Promise<Issue[]> => {
  const name = rel(workflowPath, projectPath)
  try {
    const content = await file(workflowPath).text()
    const issues: Issue[] = []
    for (const value of runsOnValues(content)) {
      const labels = value.matchAll(HOSTED_RUNNER_RE)
      for (const label of labels) issues.push(issue('ci', `${name}: runs-on names a GitHub-hosted runner (${label[0]})`))
    }
    return issues
  } catch {
    return [issue('ci', `${name}: cannot read workflow`)]
  }
}
const checkHostedRunners = async (projectPath: string): Promise<Issue[]> => {
  const workflowsPath = join(projectPath, '.github', 'workflows')
  try {
    const entries = await readdir(workflowsPath)
    const issues = await Promise.all(
      entries
        .filter(name => WORKFLOW_EXTENSION_RE.test(name))
        .map(async name => {
          const fileIssues = await hostedRunnerFileIssues(join(workflowsPath, name), projectPath)
          return fileIssues
        })
    )
    return issues.flat()
  } catch (readError) {
    if (readError instanceof Error && 'code' in readError && readError.code === 'ENOENT') return []
    return [issue('ci', '.github/workflows: cannot read workflows')]
  }
}
const checkCiRunner = async (projectPath: string): Promise<Issue[]> => {
  const hostedIssues = await checkHostedRunners(projectPath)
  const repo = await getGhRepo(projectPath)
  if (!repo) return hostedIssues
  const runners = await $`gh api repos/${repo}/actions/runners --jq '[.runners[]|select(.status=="online")]|length'`
    .quiet()
    .nothrow()
  if (runners.exitCode !== 0) {
    debug('command failed:', `gh api repos/${repo}/actions/runners`)
    return hostedIssues
  }
  const runnerIssues = Number(runners.stdout.toString().trim()) < 1 ? [issue('ci', 'no online self-hosted runner')] : []
  return [...hostedIssues, ...runnerIssues, ...(await missingVarIssues(repo))]
}
const checkRelease = async (projectPath: string): Promise<Issue[]> => {
  const caps = await detectCapabilities(projectPath)
  if (!caps.publishable) return []
  const repo = await getGhRepo(projectPath)
  if (!repo) return []
  const tags = await $`gh api repos/${repo}/tags --jq length`.quiet().nothrow()
  if (tags.exitCode !== 0) {
    debug('command failed:', `gh api repos/${repo}/tags`)
    return []
  }
  const count = Number(tags.stdout.toString().trim())
  return count > 1 ? [issue('ci', `${count} release tags (single-present-release expects 1)`)] : []
}
const nestedGitIssues = (dirty: string): Issue[] => [
  issue('git', 'skipped git pull: not a repository root'),
  ...(dirty ? [issue('git', `${dirty.split('\n').length} uncommitted changes`)] : [])
]
const checkGit = async (projectPath: string): Promise<Issue[]> => {
  const nested = await isNestedInRepo(projectPath)
  const dirtyCheck = await $`git status --porcelain -- .`.cwd(projectPath).quiet().nothrow()
  const dirty = dirtyCheck.stdout.toString().trim()
  if (nested) return nestedGitIssues(dirty)
  if (!dirty) await $`git pull --rebase`.cwd(projectPath).quiet().nothrow()
  const result = await $`git status --porcelain -- .`.cwd(projectPath).quiet().nothrow()
  if (result.exitCode !== 0) debug('command failed:', 'git status --porcelain -- .')
  const out = result.stdout.toString().trim()
  return out ? [issue('git', `${out.split('\n').length} uncommitted changes`)] : []
}
const checkDrift = async (selfPath: string, projectPath: string): Promise<Issue[]> => {
  const managed = await resolveManagedFiles(projectPath)
  const results = await Promise.all(
    managed.map(async ({ extendable, path: name }) => {
      const src = file(join(selfPath, name))
      const dst = file(join(projectPath, name))
      if (!(await src.exists())) return
      if (!(await dst.exists())) return issue('file', `${name} missing`)
      const [s, d] = await Promise.all([src.text(), dst.text()])
      if (extendable) {
        if (!isExtended(s, d)) return issue('file', `${name} out of sync`)
        return
      }
      if (s !== d) return issue('file', `${name} out of sync`)
    })
  )
  return results.filter((r): r is Issue => r !== undefined)
}
const SHERIF_COMMAND_RE = /^sherif(?:\s|$)/u
const BUN_SCRIPT_RE = /^bun[ \t]+(?<path>[\w.-]+(?:\/[\w.-]+)*)$/u
const SCOPED_SHERIF_RE = /\bsherif\b[^\r\n;&|]*?[\t "'`,]-i['"`]?[\t ,]+['"`]?typescript\b/u
const hasPostinstallSherif = async (projectPath: string, postinstall: string | undefined): Promise<boolean> => {
  const segments = (postinstall ?? '').split('&&').map(s => s.trim())
  if (segments.some(s => SHERIF_COMMAND_RE.test(s))) return true
  const wrappers = await Promise.all(
    segments.map(async s => {
      const scriptPath = BUN_SCRIPT_RE.exec(s)?.groups?.path
      if (scriptPath === undefined) return false
      try {
        const content = await file(join(projectPath, scriptPath)).text()
        return SCOPED_SHERIF_RE.test(content)
      } catch {
        return false
      }
    })
  )
  return wrappers.includes(true)
}
const checkRootPkg = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const pkg = await readPkg(join(projectPath, 'package.json'))
  if (!pkg) return issues
  if (!pkg.private) issues.push(drift('root package.json should be private'))
  if (!pkg.packageManager) issues.push(issue('missing', 'packageManager field missing'))
  if (!pkg['simple-git-hooks']) issues.push(issue('missing', 'simple-git-hooks in package.json'))
  else if (!pkg['simple-git-hooks']['pre-commit']?.endsWith(EXPECTED.preCommit))
    issues.push(drift(`pre-commit should end with "${EXPECTED.preCommit}"`))
  if (pkg.scripts?.prepare !== DEFAULT_SCRIPTS.prepare)
    issues.push(drift(`prepare should be "${DEFAULT_SCRIPTS.prepare}"`))
  if (!(await hasPostinstallSherif(projectPath, pkg.scripts?.postinstall)))
    issues.push(drift(`postinstall should include "${DEFAULT_SCRIPTS.postinstall}"`))
  if (pkg.scripts?.clean && !pkg.scripts.clean.startsWith(DEFAULT_SCRIPTS.clean))
    issues.push(drift(`clean should start with "${DEFAULT_SCRIPTS.clean}"`))
  return issues
}
const rootTsconfigIssues = (ts: Record<string, unknown> | undefined): Issue[] => {
  if (!ts) return []
  const issues: Issue[] = []
  if (ts.extends && ts.extends !== EXPECTED.tsconfigExtends)
    issues.push(drift('tsconfig.json should extend lintmax/tsconfig'))
  if (ts.include) issues.push(drift('root tsconfig.json should not have "include"'))
  if (!getTsconfigTypes(ts)?.includes('bun-types')) issues.push(issue('missing', 'root tsconfig.json missing "bun-types"'))
  return issues
}
const checkRootConfigs = async (projectPath: string, issues: Issue[]) => {
  const pkg = await readPkg(join(projectPath, 'package.json'))
  if (pkg && !pkg.scripts?.action) issues.push(issue('missing', '"action" script missing'))
  const tsconfig = await readJson(join(projectPath, 'tsconfig.json'))
  issues.push(...rootTsconfigIssues(tsconfig))
  const v = await readJson(join(projectPath, 'vercel.json'))
  if (v?.installCommand && v.installCommand !== EXPECTED.vercelInstall)
    issues.push(drift('vercel.json installCommand should be "bun i"'))
}
const checkConfigs = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const caps = await detectCapabilities(projectPath)
  await Promise.all(
    MUST_EXIST_FILES.map(async entry => {
      const entryExists = await doesPathExist(join(projectPath, entry))
      if (!entryExists) issues.push(issue('missing', entry))
    })
  )
  await Promise.all(
    CONDITIONAL_MUST_EXIST_FILES.map(async c => {
      const cExists = await doesPathExist(join(projectPath, c.path))
      if (caps[c.when] && !cExists) issues.push(issue('missing', c.path))
    })
  )
  await checkRootConfigs(projectPath, issues)
  return issues
}
const MIN_H_RE = /min-h-(?<size>screen|dvh)/u
const NESTED_GITIGNORE_ALLOW_RE = /(?:^|\/)(?:\.convex|data|fixtures|seeds|snapshots|infra|\.?venv[\w.-]*)\/\.gitignore$/u
const LAYOUT_REQUIRED: [RegExp | string, string][] = [
  ['suppressHydrationWarning', 'missing suppressHydrationWarning on <html>'],
  ['antialiased', 'missing antialiased on <body>'],
  ['tracking-[-0.02em]', 'missing tracking-[-0.02em] on <html>'],
  [MIN_H_RE, 'missing min-h-screen or min-h-dvh on <body>'],
  ['font-sans', 'missing font-sans on <html>'],
  ['Metadata', 'missing metadata export']
]
const LAYOUT_FORBIDDEN: [string, string][] = [
  ['RootLayout', 'use Layout not RootLayout'],
  ['export default function', 'use arrow function + export default Layout']
]
interface ContentRules {
  content: string
  must: [RegExp | string, string][]
  mustNot: [string, string][]
  r: string
}
const has = (content: string, check: RegExp | string) =>
  typeof check === 'string' ? content.includes(check) : check.test(content)
const checkContent = ({ content, must, mustNot, r }: ContentRules): Issue[] => {
  const issues: Issue[] = []
  for (const [check, msg] of must) if (!has(content, check)) issues.push(drift(`${msg}: ${r}`))
  for (const [check, msg] of mustNot) if (content.includes(check)) issues.push(drift(`${msg}: ${r}`))
  return issues
}
interface LayoutTailArgs {
  content: string
  hasFonts: boolean
  hasProviders: boolean
  r: string
}
const layoutTailIssues = ({ content, hasFonts, hasProviders, r }: LayoutTailArgs): Issue[] => {
  const issues: Issue[] = []
  if (!hasFonts) issues.push(drift(`missing fonts.ts next to layout: ${r}`))
  if (content.includes('Providers') && !hasProviders) issues.push(drift(`providers.tsx should be next to layout: ${r}`))
  const providerMatches = content.match(providerJsxRe) ?? []
  if (providerMatches.some(m => !serverProviderRe.test(m)) && !providerImportRe.test(content))
    issues.push(drift(`Provider in layout, move to providers.tsx: ${r}`))
  return issues
}
const checkLayouts = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const files = await glob('**/app/layout.tsx', projectPath)
  await Promise.all(
    files.map(async layoutFile => {
      const content = await file(layoutFile).text()
      const r = rel(layoutFile, projectPath)
      if (!content.includes('<html')) return
      issues.push(...checkContent({ content, must: LAYOUT_REQUIRED, mustNot: LAYOUT_FORBIDDEN, r }))
      if (content.includes("'./globals.css'") || content.includes('"./globals.css"'))
        issues.push(drift(`use global.css not globals.css: ${r}`))
      const dir = layoutFile.replace('/layout.tsx', '')
      const [hasFonts, hasProviders] = await Promise.all([
        doesPathExist(join(dir, 'fonts.ts')),
        doesPathExist(join(dir, 'providers.tsx'))
      ])
      issues.push(...layoutTailIssues({ content, hasFonts, hasProviders, r }))
    })
  )
  return issues
}
const checkPages = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const files = await glob('**/app/**/page.tsx', projectPath)
  await Promise.all(
    files.map(async pageFile => {
      const content = await file(pageFile).text()
      if (content.includes('export default function'))
        issues.push(drift(`use arrow function + export default Page: ${rel(pageFile, projectPath)}`))
    })
  )
  return issues
}
const FD_CLASS_RE =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide|placeholder|decoration|caret|accent|shadow)-fd-/u
const checkShadcnClasses = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const files = await glob('**/*.tsx', projectPath)
  await Promise.all(
    files.map(async tsxFile => {
      const content = await file(tsxFile).text()
      if (FD_CLASS_RE.test(content))
        issues.push(drift(`use shadcn semantic classes, not fd-* aliases: ${rel(tsxFile, projectPath)}`))
    })
  )
  return issues
}
const PINNED_VERSION_RE = /\d\.\d/u
const ALLOWED_VERSION_RE = /^(?:workspace:|catalog:|npm:|link:|file:)/u
const PIN_EXCEPTIONS = new Map([['typescript', '~6.0.']])
const isPinExempt = (name: string, version: string): boolean => {
  const allowed = PIN_EXCEPTIONS.get(name)
  return allowed !== undefined && version.startsWith(allowed)
}
const VERSION_RE = /(?<!\d)(?<major>\d+)\.(?<minor>\d+)(?:\.(?<patch>\d+))?/u
const versionTriple = (v: string): [number, number, number] => {
  const g = VERSION_RE.exec(v)?.groups
  return [Number(g?.major ?? 0), Number(g?.minor ?? 0), Number(g?.patch ?? 0)]
}
const isGteVersion = (a: [number, number, number], b: [number, number, number]): boolean => {
  if (a[0] !== b[0]) return a[0] > b[0]
  if (a[1] !== b[1]) return a[1] > b[1]
  return a[2] >= b[2]
}
const fetchLatest = async (name: string): Promise<string | undefined> => {
  try {
    const res = await fetch(`https://registry.npmjs.org/${name}/latest`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return
    const data = parseJson<{ version?: string }>(await res.text())
    return data.version
  } catch {
    debug('checkDepsLatest fetch failed:', name)
  }
}
const latestCache = new Map<string, Promise<string | undefined>>()
const checkDepsLatest = async (projectPath: string): Promise<Issue[]> => {
  const files = await glob('**/package.json', projectPath)
  const candidates: { name: string; r: string; version: string }[] = []
  await Promise.all(
    files.map(async pkgFile => {
      const pkg = await readPkg(pkgFile)
      if (!pkg) return
      const r = rel(pkgFile, projectPath)
      const deps = (['dependencies', 'devDependencies'] as const).flatMap(field => Object.entries(pkg[field] ?? {}))
      for (const [name, version] of deps)
        if (
          typeof version === 'string' &&
          PINNED_VERSION_RE.test(version) &&
          !ALLOWED_VERSION_RE.test(version) &&
          !isPinExempt(name, version)
        )
          candidates.push({ name, r, version })
    })
  )
  const latestByName = new Map<string, string | undefined>()
  await Promise.all(
    [...new Set(candidates.map(c => c.name))].map(async name => {
      const cached = latestCache.get(name) ?? fetchLatest(name)
      latestCache.set(name, cached)
      latestByName.set(name, await cached)
    })
  )
  const issues: Issue[] = []
  for (const c of candidates) {
    const latest = latestByName.get(c.name)
    if (latest !== undefined && isGteVersion(versionTriple(latest), versionTriple(c.version)))
      issues.push(drift(`${c.name}@${c.version} pinned, use "latest" (latest ${latest}): ${c.r}`))
  }
  return issues
}
const checkTypescriptPin = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const files = await glob('**/package.json', projectPath)
  await Promise.all(
    files.map(async pkgFile => {
      const r = rel(pkgFile, projectPath)
      if (r.startsWith(READONLY_UI)) return
      const pkg = await readPkg(pkgFile)
      if (!pkg) return
      for (const field of ['dependencies', 'devDependencies'] as const) {
        const version = pkg[field]?.typescript
        if (typeof version === 'string' && !isPinExempt('typescript', version))
          issues.push(drift(`typescript@${version} must be pinned to ${PIN_EXCEPTIONS.get('typescript') ?? ''}x: ${r}`))
      }
    })
  )
  return issues
}
const SHERIF_SCOPE = '-i typescript'
const checkSherifScope = async (projectPath: string): Promise<Issue[]> => {
  const hasReadonlyUi = await doesPathExist(join(projectPath, READONLY_UI))
  if (!hasReadonlyUi) return []
  const pkg = await readPkg(join(projectPath, 'package.json'))
  const postinstall = pkg?.scripts?.postinstall
  const hasUnscopedSherif = (postinstall ?? '')
    .split('&&')
    .map(s => s.trim())
    .some(s => SHERIF_COMMAND_RE.test(s) && !s.includes(SHERIF_SCOPE))
  if (!hasUnscopedSherif) return []
  return [drift(`postinstall sherif should scope "${SHERIF_SCOPE}" (workspace ~6.0 vs ${READONLY_UI} ^5)`)]
}
const checkActionRunsTests = async (projectPath: string): Promise<Issue[]> => {
  const pkg = await readPkg(join(projectPath, 'package.json'))
  const scripts = pkg?.scripts
  if (!scripts?.test) return []
  const { action } = scripts
  if (typeof action !== 'string' || action.includes('test')) return []
  return [drift('"action" should run "test" — a declared suite that ci never invokes rots unseen')]
}
const DEFAULT_EXPORT_RE = /export default (?<id>\w+)/u
const doesDelegateConfig = (content: string): boolean => {
  const id = DEFAULT_EXPORT_RE.exec(content)?.groups?.id
  return id !== undefined && content.split('\n').some(line => line.trimStart().startsWith('import') && line.includes(id))
}
const NEXT_AGENT_RULES_RE = /agentRules\s*:\s*false\b/u
const checkNextConfigs = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const configs = await glob('**/next.config.ts', projectPath)
  await Promise.all(
    configs.map(async configFile => {
      const content = await file(configFile).text()
      const inherited = content.includes('createNextConfig') || doesDelegateConfig(content)
      if (!(content.includes('reactStrictMode') || inherited))
        issues.push(drift(`missing reactStrictMode in ${rel(configFile, projectPath)}`))
      if (!(NEXT_AGENT_RULES_RE.test(content) || inherited))
        issues.push(drift(`missing agentRules: false in ${rel(configFile, projectPath)}`))
    })
  )
  const postcssConfigs = await glob('**/apps/*/postcss.config.*', projectPath)
  for (const f of postcssConfigs) issues.push(drift(`redundant ${rel(f, projectPath)}, remove it`))
  return issues
}
const DOT_DIR_RE = /(?:^|\/)\.[^/]/u
const doesNameADotDir = (include: unknown): boolean =>
  Array.isArray(include) && include.some(entry => typeof entry === 'string' && DOT_DIR_RE.test(entry))
const checkAppTsconfigs = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const files = await glob('**/apps/*/tsconfig.json', projectPath)
  await Promise.all(
    files.map(async tsconfigFile => {
      const ts = await readJson(tsconfigFile)
      const r = rel(tsconfigFile, projectPath)
      if (!ts) return
      if (!ts.extends) issues.push(drift(`${r} should extend lintmax/tsconfig`))
      if (ts.include && !doesNameADotDir(ts.include)) issues.push(drift(`${r} should not have "include"`))
    })
  )
  return issues
}
const strayConfigIssues = async (projectPath: string): Promise<Issue[]> => {
  const gitignores = await glob('**/.gitignore', projectPath)
  const nested = gitignores
    .filter(f => f !== join(projectPath, '.gitignore'))
    .filter(f => !NESTED_GITIGNORE_ALLOW_RE.test(rel(f, projectPath)))
  const mjsConfigs = await glob('**/postcss.config.mjs', projectPath)
  return [
    ...(nested.length > 0 ? [drift(`nested .gitignore: ${nested.map(f => rel(f, projectPath)).join(', ')}`)] : []),
    ...(mjsConfigs.length > 0 ? [drift('postcss.config.mjs should be .ts')] : [])
  ]
}
const checkForbidden = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  await Promise.all(
    FORBIDDEN_LOCKFILES.map(async f => {
      const lockExists = await doesPathExist(join(projectPath, f))
      if (lockExists) issues.push(forbidden(`${f} found, use bun only`))
    })
  )
  const [bunLockTracked, tsNoCheck] = await Promise.all([
    $`git ls-files bun.lock`.cwd(projectPath).quiet().nothrow(),
    $`rg '^// @ts-nocheck|^/\* @ts-nocheck' ${projectPath} -g '*.ts' -g '*.tsx' ${RG_EXCLUDE} -l`.quiet().nothrow()
  ])
  if (bunLockTracked.stdout.toString().trim()) issues.push(forbidden('bun.lock tracked in git, should be gitignored'))
  issues.push(...(await strayConfigIssues(projectPath)))
  const tsNoCheckFiles = tsNoCheck.stdout.toString().trim()
  if (tsNoCheckFiles) issues.push(forbidden(`@ts-nocheck in: ${relList(tsNoCheckFiles, projectPath)}`))
  return issues
}
const BUN_GLOBAL_RE = /Bun\.\w+/gu
const BUN_EXTERNAL_RE = /neverBundle.*bun/u
const TSDOWN_CONFIG_RE = /(?:^|\/)tsdown\.config\.[jt]s$/u
const TS_SOURCE_RE = /\.(?:ts|tsx)$/u
const bunGlobalIssues = async (sources: Map<string, string>, pkgJsonFiles: string[]): Promise<Issue[]> => {
  const hasNext = (
    await Promise.all(
      pkgJsonFiles.map(async pkgPath => {
        const raw = await readPkg(pkgPath)
        return raw
          ? Object.keys({ ...raw.dependencies, ...raw.devDependencies, ...raw.peerDependencies }).includes('next')
          : false
      })
    )
  ).some(Boolean)
  const entries = [...sources]
  const doesKeepBunExternal = entries.some(
    ([path, content]) => TSDOWN_CONFIG_RE.test(path) && BUN_EXTERNAL_RE.test(content)
  )
  if (hasNext || doesKeepBunExternal) return []
  const bunGlobals = entries
    .filter(([path]) => TS_SOURCE_RE.test(path) && !path.endsWith('.d.ts'))
    .flatMap(([, content]) => content.match(BUN_GLOBAL_RE) ?? [])
  const fixable = [...new Set(bunGlobals)].filter(g => BUN_GLOBALS[g])
  if (fixable.length === 0) return []
  const imports = fixable.map(g => `${g} → ${BUN_GLOBALS[g]}`).join(', ')
  return [forbidden(`use named imports: ${imports}`)]
}
type Banned = typeof ALL_BANNED
interface BanResult {
  ban: string
  files: string
  fix: string
}
const sourceBanResults = async (projectPath: string, banned: Banned, cache: Map<string, string>) => {
  const candidates = await bannedImportFiles(
    projectPath,
    banned.map(({ ban }) => importPattern(ban))
  )
  const sources = await readSources(candidates, cache)
  return banned.map(({ ban, fix }): BanResult | undefined => {
    const files = [...sources]
      .filter(([, content]) => hasBlockedImport(content, ban))
      .map(([path]) => path)
      .join('\n')
    return files ? { ban, files, fix } : undefined
  })
}
const pkgBanResults = async (pkgJsonFiles: string[], banned: Banned): Promise<BanResult[]> => {
  const results = await Promise.all(
    pkgJsonFiles.map(async pkgPath => {
      const raw = await readPkg(pkgPath)
      if (!raw) return []
      const depNames = Object.keys({ ...raw.dependencies, ...raw.devDependencies, ...raw.peerDependencies })
      return banned
        .filter(({ ban }) => {
          const clean = ban.replaceAll(/^"|"$/gu, '')
          return ban.endsWith('"')
            ? depNames.includes(clean) && !isTemporarilyAllowedPackage(ban, clean)
            : depNames.some(d => d.startsWith(clean) && !isTemporarilyAllowedPackage(ban, d))
        })
        .map(({ ban, fix }) => ({ ban, files: pkgPath, fix }))
    })
  )
  return results.flat()
}
const diagnosticIssues = async (projectPath: string, cache: Map<string, string>, pkgJsonFiles: string[]) => {
  const diagnostics = await shell(
    projectPath,
    '-g',
    'tsdown.config.js',
    '-e',
    `${UI_PACKAGE_NAME}/lib/`,
    '-e',
    String.raw`Bun\.\w+`,
    '-e',
    BUN_EXTERNAL_RE.source
  )
  const diagnosticSources = await readSources(diagnostics, cache)
  const issues = await bunGlobalIssues(diagnosticSources, pkgJsonFiles)
  const deepUi = [...diagnosticSources]
    .filter(([path, content]) => TS_SOURCE_RE.test(path) && content.includes(`${UI_PACKAGE_NAME}/lib/`))
    .map(([path]) => path)
    .join('\n')
  if (deepUi)
    issues.push(forbidden(`use import { cn } from '${UI_PACKAGE_NAME}', not deep paths: ${relList(deepUi, projectPath)}`))
  return issues
}
const bannedImportIssues = async (projectPath: string): Promise<Issue[]> => {
  const isLintmax = projectPath.includes('/lintmax')
  const banned = [...ALL_BANNED, ...(isLintmax ? [] : LINTMAX_ONLY)].filter(b => !TEMPORARY.has(b.ban))
  const cache = new Map<string, string>()
  const sourceResults = await sourceBanResults(projectPath, banned, cache)
  const pkgJsonFiles = await glob('**/package.json', projectPath)
  const pkgResults = await pkgBanResults(pkgJsonFiles, banned)
  const issues = [...sourceResults, ...pkgResults].flatMap(r =>
    r ? [forbidden(`${r.ban} banned, use ${r.fix}: ${relList(r.files, projectPath)}`)] : []
  )
  issues.push(...(await diagnosticIssues(projectPath, cache, pkgJsonFiles)))
  return issues
}
const checkBannedImports = async (projectPath: string): Promise<Issue[]> => {
  try {
    return await bannedImportIssues(projectPath)
  } catch (scanError) {
    return [forbidden(`banned import scan failed: ${scanError instanceof Error ? scanError.message : String(scanError)}`)]
  }
}
/** Vercel posts its deploy status to the GitHub deployments API, so checkVercel reads the auto-deploy
 * pipeline's health there as reliable JSON — not the TTY-only `vercel ls` table, which prints URLs with no
 * state when captured, and not the gitignored `.vercel` link dir the old check keyed on (absent on a fresh
 * checkout, so it never ran). It stays red while a manual prebuilt deploy papers over a broken push-to-deploy. */
const DEPLOY_FAILED_STATES = new Set(['error', 'failure'])
const isDeployStateFailed = (state: string): boolean => DEPLOY_FAILED_STATES.has(state.trim())
const latestDeploymentId = async (repo: string): Promise<number | undefined> => {
  const deploymentsUrl = `repos/${repo}/deployments?per_page=1`
  const dep = await $`gh api ${deploymentsUrl}`.quiet().nothrow()
  if (dep.exitCode !== 0) {
    debug('gh api deployments failed for', repo)
    return
  }
  const deployments = parseJson<{ id?: number }[]>(dep.stdout.toString().trim() || '[]')
  return deployments[0]?.id
}
const latestDeploymentState = async (repo: string, id: number): Promise<string> => {
  const statusesUrl = `repos/${repo}/deployments/${id}/statuses?per_page=1`
  const st = await $`gh api ${statusesUrl}`.quiet().nothrow()
  if (st.exitCode !== 0) return ''
  const statuses = parseJson<{ state?: string }[]>(st.stdout.toString().trim() || '[]')
  return statuses[0]?.state ?? ''
}
const checkVercel = async (projectPath: string): Promise<Issue[]> => {
  if (!(await doesPathExist(join(projectPath, 'vercel.json')))) return []
  const repo = await getGhRepo(projectPath)
  if (!repo) return []
  const id = await latestDeploymentId(repo)
  if (id === undefined) return []
  return isDeployStateFailed(await latestDeploymentState(repo, id))
    ? [issue('deploy', 'vercel production deploy failed — build locally then `vercel deploy --prebuilt --prod`')]
    : []
}
const FUMADOCS_NEXT_BUILD_RE = /(?<!bunx --bun )\bnext build\b/u
const FUMADOCS_MDX_BARE_RE = /(?<!bunx --bun )\bfumadocs-mdx\b/u
const checkFumadocsBuild = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const pkgFiles = await glob('**/package.json', projectPath)
  const pkgResults = await Promise.all(
    pkgFiles.map(async pkgPath => {
      const pkg = await readPkg(pkgPath)
      if (!pkg) return
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
      if (allDeps['fumadocs-ui']) return { path: pkgPath, scripts: pkg.scripts ?? {} }
    })
  )
  const fumadocsPkgs = pkgResults.filter((e): e is { path: string; scripts: Record<string, string> } => e !== undefined)
  for (const entry of fumadocsPkgs)
    for (const [name, script] of Object.entries(entry.scripts))
      if (FUMADOCS_NEXT_BUILD_RE.test(script) || FUMADOCS_MDX_BARE_RE.test(script))
        issues.push(drift(`${rel(entry.path, projectPath)} script "${name}" missing bunx --bun prefix`))
  return issues
}
// eslint-disable-next-line regexp/no-contradiction-with-assertion -- \b anchors the nav attribute to a word boundary inside the tag; the assertion is satisfiable via attribute whitespace and intended
const FUMADOCS_INLINE_NAV_RE = /<(?:DocsLayout|HomeLayout)[^>]*\bnav=\{/u
const ALIAS_TRIM_TAIL_RE = /\/\*$/u
const ALIAS_DOT_SLASH_RE = /^\.\//u
const sharedLayoutPath = async (appDir: string): Promise<string> => {
  const tsconfig = await readJson(join(appDir, 'tsconfig.json'))
  /** biome-ignore lint/nursery/noUnsafeTypeAssertion: compilerOptions is read from validated tsconfig JSON */
  const aliasTarget = (tsconfig?.compilerOptions as TsconfigCompilerOptions | undefined)?.paths?.['@/*']?.[0]
  const libBase = aliasTarget ? aliasTarget.replace(ALIAS_TRIM_TAIL_RE, '').replace(ALIAS_DOT_SLASH_RE, '') || '.' : 'src'
  const sharedRel = libBase === '.' ? 'lib/layout.shared.tsx' : `${libBase}/lib/layout.shared.tsx`
  return join(appDir, sharedRel)
}
const sharedLayoutIssues = async (sharedPath: string, projectPath: string): Promise<Issue[]> => {
  if (!(await doesPathExist(sharedPath))) return [drift(`${rel(sharedPath, projectPath)} missing (fumadocs SSOT)`)]
  const content = await file(sharedPath).text()
  return content.includes('githubUrl:') ? [] : [drift(`${rel(sharedPath, projectPath)} missing githubUrl in baseOptions`)]
}
const inlineNavIssues = async (appDir: string, projectPath: string): Promise<Issue[]> => {
  const tsxFiles = await glob('**/*.tsx', appDir)
  const tsxIssues = await Promise.all(
    tsxFiles.map(async tsxPath => {
      const content = await file(tsxPath).text()
      if (!content.includes('fumadocs-ui/layouts')) return
      if (FUMADOCS_INLINE_NAV_RE.test(content) && !content.includes('baseOptions'))
        return drift(`${rel(tsxPath, projectPath)} uses inline nav={...}; spread {...baseOptions()} instead`)
    })
  )
  return tsxIssues.filter((t): t is Issue => t !== undefined)
}
const checkFumadocsGithubUrl = async (projectPath: string): Promise<Issue[]> => {
  const pkgFiles = await glob('**/package.json', projectPath)
  const fumadocsDirs = (
    await Promise.all(
      pkgFiles.map(async pkgPath => {
        const pkg = await readPkg(pkgPath)
        if (!pkg) return
        const deps = { ...pkg.dependencies, ...pkg.devDependencies }
        return deps['fumadocs-ui'] ? join(pkgPath, '..') : undefined
      })
    )
  ).filter((d): d is string => d !== undefined)
  const perDir = await Promise.all(
    fumadocsDirs.map(async appDir => {
      const sharedPath = await sharedLayoutPath(appDir)
      const sharedIssues = await sharedLayoutIssues(sharedPath, projectPath)
      const navIssues = await inlineNavIssues(appDir, projectPath)
      return [sharedIssues, navIssues].flat()
    })
  )
  return perDir.flat()
}
const checkMergeMarkers = async (projectPath: string): Promise<Issue[]> => {
  const result = await $`rg -l --multiline-dotall -n '^(<{7}|={7}|>{7})' ${projectPath} ${RG_EXCLUDE}`.quiet().nothrow()
  const out = result.stdout.toString().trim()
  if (!out) return []
  return [forbidden(`unresolved merge markers in: ${relList(out, projectPath)}`)]
}
const ENV_LINE_RE = /^\s*(?<key>[A-Za-z_]\w*)\s*=/u
const GENERATED_API_RE = /\/_generated\/api\.d\.ts$/u
const ENV_CANDIDATES = ['apps/backend/.env', '.env', 'apps/convex/.env']
const parseEnvKeys = (text: string): Set<string> => {
  const keys = new Set<string>()
  for (const line of text.split('\n')) {
    const m = ENV_LINE_RE.exec(line)
    const key = m?.groups?.key
    if (key && !line.trimStart().startsWith('#')) keys.add(key)
  }
  return keys
}
const NODE_ENV_PRODUCTION_RG = String.raw`process\.env(\.NODE_ENV|\['NODE_ENV'\]|\["NODE_ENV"\]).*['"]production['"]`
const CONVEX_SOURCE_GLOBS = ['-g', '*.ts', '-g', '*.tsx', '-g', '!_generated/**', '-g', '!*.test.ts']
const CONVEX_ENV_SET_GLOBS = [
  '-g',
  '*.ts',
  '-g',
  '*.tsx',
  '-g',
  '!**/sync*.ts',
  '-g',
  '!**/scripts/test-*.ts',
  '-g',
  '!**/global-setup*.ts'
]
interface ConvexEnv {
  p: string
  text: string
}
const findConvexEnv = async (projectPath: string): Promise<ConvexEnv | undefined> => {
  const envFiles = await Promise.all(
    ENV_CANDIDATES.map(async cand => {
      const p = join(projectPath, cand)
      const doesPExist = await doesPathExist(p)
      if (!doesPExist) return
      const text = await file(p).text()
      return text.includes('CONVEX_SELF_HOSTED_URL') ? { p, text } : undefined
    })
  )
  return envFiles.find((e): e is ConvexEnv => e !== undefined)
}
const convexSourceIssues = (nodeEnvOuts: string[], setOut: string, projectPath: string): Issue[] => {
  const nodeEnvIssues = nodeEnvOuts
    .filter(Boolean)
    .map(out =>
      forbidden(
        "NODE_ENV === 'production' branch in convex/ (always true on self-hosted; " +
          `gate on explicit env flag instead): ${relList(out, projectPath)}`
      )
    )
  return setOut
    ? [
        ...nodeEnvIssues,
        forbidden(`'convex env set' outside sync.ts (.env is source of truth): ${relList(setOut, projectPath)}`)
      ]
    : nodeEnvIssues
}
interface ConvexAuthArgs {
  envHit: ConvexEnv
  envKeys: Set<string>
  pkgs: (PackageJson | undefined)[]
  projectPath: string
}
const convexAuthIssues = ({ envHit, envKeys, pkgs, projectPath }: ConvexAuthArgs): Issue[] => {
  const isAuthUsed = pkgs.some(pkg => Boolean({ ...pkg?.dependencies, ...pkg?.devDependencies }['@convex-dev/auth']))
  const authIssues = isAuthUsed
    ? ['JWT_PRIVATE_KEY', 'JWKS']
        .filter(k => !envKeys.has(k))
        .map(k => issue('missing', `${k} required by @convex-dev/auth in ${rel(envHit.p, projectPath)}`))
    : []
  return envKeys.has('SITE_URL')
    ? authIssues
    : [...authIssues, issue('missing', `SITE_URL required for Convex auth callbacks in ${rel(envHit.p, projectPath)}`)]
}
const checkConvexSelfHosted = async (projectPath: string): Promise<Issue[]> => {
  const generated = await glob('**/convex/_generated/api.d.ts', projectPath)
  if (generated.length === 0) return []
  const envHit = await findConvexEnv(projectPath)
  if (!envHit) return []
  const convexDirs = generated.map(g => g.replace(GENERATED_API_RE, ''))
  const [nodeEnvHits, setHits, pkgFiles] = await Promise.all([
    Promise.all(
      convexDirs.map(async d =>
        $`rg -l ${NODE_ENV_PRODUCTION_RG} ${d} ${CONVEX_SOURCE_GLOBS} ${RG_EXCLUDE}`.quiet().nothrow()
      )
    ),
    $`rg -l 'convex env set' ${projectPath} ${CONVEX_ENV_SET_GLOBS} ${RG_EXCLUDE}`.quiet().nothrow(),
    glob('**/package.json', projectPath)
  ])
  const sourceIssues = convexSourceIssues(
    nodeEnvHits.map(r => r.stdout.toString().trim()),
    setHits.stdout.toString().trim(),
    projectPath
  )
  const pkgs = await Promise.all(pkgFiles.map(async p => readPkg(p)))
  return [...sourceIssues, ...convexAuthIssues({ envHit, envKeys: parseEnvKeys(envHit.text), pkgs, projectPath })]
}
const HERMETIC_TEST_GLOBS = [
  '-g',
  '*.test.ts',
  '-g',
  '*.test.tsx',
  '-g',
  '*.spec.ts',
  '-g',
  '*.e2e.ts',
  '-g',
  '!*-live.test.ts',
  '-g',
  '!*.live.test.ts'
]
const HERMETIC_TEST_PATTERNS = [
  String.raw`git\s+(clone|fetch|pull|push|ls-remote)\b[^\n]*(https?://|git@)`,
  '(fetch|\\.goto|got|axios\\.[a-z]+|\\.request)\\(([\'"`])https?://'
]
const LOCAL_HOST_RE = /localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal/u
const HOME_READ_RG = String.raw`(?:os\.)?homedir\(\)|process\.env(?:\.HOME\b|\[['"]HOME)`
const HOME_SWAP_RE = /process\.env(?:\.HOME|\[['"]HOME['"]\])\s*=[^=]/u
const PERF_TIME_RG = String.raw`performance\.now\(\)|process\.hrtime\b`
const locateHit = (line: string, projectPath: string): string => {
  const [path, lineNo] = line.split(':')
  return path ? `${rel(path, projectPath)}:${lineNo ?? ''}` : line
}
const hermeticNetIssues = async (projectPath: string): Promise<Issue[]> => {
  const rgArgs = HERMETIC_TEST_PATTERNS.flatMap(p => ['-e', p])
  const netResult = await $`rg -n ${rgArgs} ${projectPath} ${HERMETIC_TEST_GLOBS} ${RG_EXCLUDE}`.quiet().nothrow()
  const netOffenders = netResult.stdout
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter(line => !LOCAL_HOST_RE.test(line))
    .map(line => locateHit(line, projectPath))
  if (netOffenders.length === 0) return []
  return [
    forbidden(
      'non-hermetic network in test — use a local bare repo, mock the call, ' +
        `or gate a live test behind a credential: ${netOffenders.join(', ')}`
    )
  ]
}
const hermeticHomeIssues = async (projectPath: string): Promise<Issue[]> => {
  const homeResult = await $`rg -l -e ${HOME_READ_RG} ${projectPath} ${HERMETIC_TEST_GLOBS} ${RG_EXCLUDE}`
    .quiet()
    .nothrow()
  const homeFiles = homeResult.stdout.toString().trim().split('\n').filter(Boolean)
  const ambient = (
    await Promise.all(
      homeFiles.map(async f => (HOME_SWAP_RE.test(await file(f).text()) ? undefined : rel(f, projectPath)))
    )
  ).filter((x): x is string => x !== undefined)
  if (ambient.length === 0) return []
  return [
    forbidden(
      'non-hermetic ambient state in test — reads the real home dir; write fixtures to a temp dir ' +
        `or swap process.env.HOME to an isolated dir: ${ambient.join(', ')}`
    )
  ]
}
const hermeticTimingIssues = async (projectPath: string): Promise<Issue[]> => {
  const timeResult = await $`rg -n -e ${PERF_TIME_RG} ${projectPath} ${HERMETIC_TEST_GLOBS} ${RG_EXCLUDE}`
    .quiet()
    .nothrow()
  const timing = timeResult.stdout
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => locateHit(line, projectPath))
  if (timing.length === 0) return []
  return [
    forbidden(
      'non-hermetic timing in test — a wall-clock micro-benchmark (performance.now/hrtime) ' +
        `flakes on a loaded runner; assert the outcome, not the elapsed time: ${timing.join(', ')}`
    )
  ]
}
const checkHermeticTests = async (projectPath: string): Promise<Issue[]> => {
  const netIssues = await hermeticNetIssues(projectPath)
  const homeIssues = await hermeticHomeIssues(projectPath)
  const timingIssues = await hermeticTimingIssues(projectPath)
  return [...netIssues, ...homeIssues, ...timingIssues]
}
const UTILITY_CLASS =
  String.raw`(class(Name)?[=:]\s*["'\`][^"'\`]*)(p[trblxy]?|m[trblxy]?|w|h|gap|text|bg|rounded|border|flex|` +
  String.raw`grid-cols|grid-rows|leading|tracking|size|inset|top|left|right|bottom|space-[xy]|min-[wh]|max-[wh])-\[`
const IMPORT_SPECIFIER = `from ['"][^'"]+['"]`
const UTILITY_GLOBS = [
  '-g',
  '*.js',
  '-g',
  '*.mjs',
  '-g',
  '*.cjs',
  '-g',
  '*.jsx',
  '-g',
  '*.tsx',
  '-g',
  '*.css',
  '-g',
  '!**/_next/static/**',
  '-g',
  '!**/static/chunks/**'
]
const doesShipUtilityClasses = async (depDir: string): Promise<boolean> => {
  const out = (
    await $`rg -c --max-count=3 --no-ignore --no-messages ${UTILITY_GLOBS} ${UTILITY_CLASS} ${depDir}`.quiet().nothrow()
  ).stdout.toString()
  const total = out.split('\n').reduce((sum, line) => sum + (Number(line.split(':').pop()) || 0), 0)
  return total >= 3
}
const IMPORT_MATCH = /from ['"](?<spec>[^'"]+)['"]/gu
const escapeRe = (s: string): string => s.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
const packageOfSpecifier = (spec: string): string | undefined => {
  if (spec.startsWith('.') || spec.startsWith('@a/') || spec.startsWith('node:')) return
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec)
}
const importedPackages = async (projectPath: string): Promise<Set<string>> => {
  const out = (
    await $`rg -oN --no-messages ${IMPORT_SPECIFIER} ${projectPath} -g '*.ts' -g '*.tsx' ${RG_EXCLUDE}`.quiet().nothrow()
  ).stdout.toString()
  const names = new Set<string>()
  for (const m of out.matchAll(IMPORT_MATCH)) {
    const pkg = packageOfSpecifier(m.groups?.spec ?? '')
    if (pkg) names.add(pkg)
  }
  return names
}
const appRootOf = async (cssPath: string, projectPath: string): Promise<string> => {
  const dirs: string[] = []
  let dir = dirname(cssPath)
  while (dir.startsWith(projectPath) && dir !== projectPath) {
    dirs.push(dir)
    dir = dirname(dir)
  }
  const hasPkg = await Promise.all(dirs.map(async candidate => doesPathExist(join(candidate, 'package.json'))))
  const idx = hasPkg.findIndex(Boolean)
  return idx === -1 ? projectPath : (dirs[idx] ?? projectPath)
}
const checkTailwindSourceCoverage = async (projectPath: string): Promise<Issue[]> => {
  const cssFiles = await glob('**/*.css', projectPath)
  const entries = (
    await Promise.all(
      cssFiles.map(async css => {
        const text = await file(css).text()
        const isEntry = text.includes('@a/ui/globals.css') || text.includes("@import 'tailwindcss'")
        return isEntry ? { css, text } : undefined
      })
    )
  ).filter((e): e is { css: string; text: string } => e !== undefined)
  if (entries.length === 0) return []
  const perEntry = await Promise.all(
    entries.map(async e => {
      const pkgs = await importedPackages(await appRootOf(e.css, projectPath))
      const flagged = await Promise.all(
        [...pkgs].map(async name => {
          const depDir = join(projectPath, 'node_modules', name)
          if (!((await doesPathExist(depDir)) && (await doesShipUtilityClasses(depDir)))) return
          const sourced = new RegExp(String.raw`@source[^\n]*[/'"]${escapeRe(name)}(/|['"])`, 'u')
          const importsDepCss = new RegExp(String.raw`@import\s+['"]${escapeRe(name)}/[^'"]+\.css`, 'u')
          return sourced.test(e.text) || importsDepCss.test(e.text)
            ? undefined
            : drift(
                `${rel(e.css, projectPath)} imports ${name} (ships Tailwind utility classes) ` +
                  'but its global.css does not @source it — the classes render inert'
              )
        })
      )
      return flagged.filter((i): i is Issue => i !== undefined)
    })
  )
  return perEntry.flat()
}
const TEMPLATES_DIR = 'packages/pm4ai/src/templates'
const PKGNAME_TOKEN = 'pkgname'
interface ScaffoldTemplate {
  dir: string
  name: string
}
const scaffoldTemplates = async (templatesDir: string): Promise<ScaffoldTemplate[]> => {
  const entries = await readdir(templatesDir, { withFileTypes: true })
  const found = await Promise.all(
    entries
      .filter(e => e.isDirectory())
      .map(async e => {
        const pkg = await readPkg(join(templatesDir, e.name, 'package.json'))
        return pkg?.name === undefined ? undefined : { dir: e.name, name: pkg.name }
      })
  )
  return found.filter((t): t is ScaffoldTemplate => t !== undefined)
}
const adversarialNames = (templates: ScaffoldTemplate[]): string[] => {
  const candidates = new Set(templates.map(t => t.dir))
  for (const t of templates)
    for (const segment of t.name.replace('@', '').split('/'))
      if (segment.length > 0 && !segment.includes(PKGNAME_TOKEN)) candidates.add(segment)
  return [...candidates]
}
const unparameterisedTemplates = (templates: ScaffoldTemplate[]): Issue[] =>
  templates
    .filter(t => !t.name.includes(PKGNAME_TOKEN))
    .map(t =>
      drift(
        `scaffold template ${t.dir} names itself "${t.name}" with no ${PKGNAME_TOKEN} — ` +
          'a project of that name scaffolds two workspace packages with one name and bun i refuses the install'
      )
    )
const collisionGroups = (templates: ScaffoldTemplate[], candidate: string): [string, string[]][] => {
  const byProduced = new Map<string, string[]>()
  for (const t of templates) {
    const produced = t.name.replaceAll(PKGNAME_TOKEN, candidate)
    byProduced.set(produced, [...(byProduced.get(produced) ?? []), t.dir])
  }
  return [...byProduced].filter(([, dirs]) => dirs.length > 1)
}
const collidingTemplates = (templates: ScaffoldTemplate[]): Issue[] => {
  const collisions = adversarialNames(templates).flatMap(candidate =>
    collisionGroups(templates, candidate).map(([produced, dirs]) => ({ candidate, key: dirs.join(','), produced }))
  )
  return collisions
    .filter((c, index) => collisions.findIndex(o => o.key === c.key) === index)
    .map(c =>
      drift(
        `scaffold templates ${c.key} both produce workspace package "${c.produced}" for a project named "${c.candidate}"`
      )
    )
}
const checkScaffoldNames = async (projectPath: string): Promise<Issue[]> => {
  const templatesDir = join(projectPath, TEMPLATES_DIR)
  if (!(await doesPathExist(templatesDir))) return []
  const templates = await scaffoldTemplates(templatesDir)
  if (templates.length === 0) return []
  return [...unparameterisedTemplates(templates), ...collidingTemplates(templates)]
}
export {
  checkActionRunsTests,
  checkAppTsconfigs,
  checkBannedImports,
  checkCi,
  checkCiRunner,
  checkConfigs,
  checkConvexSelfHosted,
  checkDepsLatest,
  checkDrift,
  checkForbidden,
  checkFumadocsBuild,
  checkFumadocsGithubUrl,
  checkGit,
  checkHermeticTests,
  checkHostedRunners,
  checkLayouts,
  checkMergeMarkers,
  checkNextConfigs,
  checkPages,
  checkRelease,
  checkRootPkg,
  checkScaffoldNames,
  checkShadcnClasses,
  checkSherifScope,
  checkTailwindSourceCoverage,
  checkTypescriptPin,
  checkVercel,
  isDeployStateFailed as deployStateFailed,
  hasPostinstallSherif
}
