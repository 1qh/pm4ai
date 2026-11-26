/** biome-ignore-all lint/performance/noDelete: must delete pkg keys */
/** biome-ignore-all lint/performance/noAwaitInLoops: ordered fs existence probes return first match */
import { $, file, spawn, write } from 'bun'
import { access, cp, mkdir, readlink, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DepField, Issue, PackageJson } from './types.js'
import { isPublishedPkg } from './audit.js'
import {
  CLAUDE_MD,
  DEFAULT_DEP_VERSION,
  DEFAULT_FILES,
  DEFAULT_LICENSE,
  DEFAULT_SCRIPTS,
  EXPECTED,
  filterTurboWorkspaceWarning,
  READONLY_UI,
  REQUIRED_ROOT_DEVDEPS,
  TSDOWN_BASE,
  TURBO_FLAG,
  TURBO_WARNING_FILTER
} from './constants.js'
import { inferRules } from './infer.js'
import { parseJson } from './json.js'
import { DEP_FIELDS } from './types.js'
import {
  buildPkgDepMap,
  collectWorkspacePackages,
  getGhRepo,
  getTsconfigTypes,
  gitCleanRe,
  isExtended,
  isSkippedPath,
  mergeExtendable,
  providedByWorkspaces,
  readJson,
  readPkg,
  resolveManagedFiles,
  staleConditionalFiles,
  writeJson
} from './utils.js'
const doesPathExist = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
const sortKeys = (obj: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(obj).toSorted(([a], [b]) => a.localeCompare(b)))
const stripFrontmatter = (content: string): string => {
  if (!content.startsWith('---')) return content
  const endIdx = content.indexOf('---', 3)
  if (endIdx === -1) return content
  return content.slice(endIdx + 3).trim()
}
const FRONTMATTER_TITLE_RE = /^title:\s*(?<title>\S.*)$/mu
const frontmatterTitle = (content: string): string | undefined => {
  if (!content.startsWith('---')) return
  const endIdx = content.indexOf('---', 3)
  if (endIdx === -1) return
  return FRONTMATTER_TITLE_RE.exec(content.slice(3, endIdx))?.groups?.title?.trim()
}
const HEADING_RE = /^#{1,5} /u
const FENCE_RE = /^\s*```/u
/** Shift every markdown heading one level deeper, skipping fenced code blocks, so a rule authored at `##` nests under its `##` topic title in the assembled guide instead of competing as another H1. */
const shiftHeadings = (body: string): string => {
  let isInFence = false
  return body
    .split('\n')
    .map(line => {
      if (FENCE_RE.test(line)) isInFence = !isInFence
      return !isInFence && HEADING_RE.test(line) ? `#${line}` : line
    })
    .join('\n')
}
const ruleBlock = (content: string): string => {
  const title = frontmatterTitle(content)
  const body = shiftHeadings(stripFrontmatter(content))
  return title ? `## ${title}\n\n${body}` : body
}
const GUIDE_TITLE = 'pm4ai — Managed Repo Guide'
const NON_SLUG_RE = /[^a-z0-9]+/gu
const EDGE_HYPHEN_RE = /^-|-$/gu
const slug = (title: string): string => title.toLowerCase().replaceAll(NON_SLUG_RE, '-').replaceAll(EDGE_HYPHEN_RE, '')
const buildContents = (titles: string[]): string =>
  ['## Contents', '', ...titles.map(t => `- [${t}](#${slug(t)})`)].join('\n')
interface GeneratedGuide {
  content?: string
  error?: string
}
type MutableCompilerOptions = Record<string, unknown>
interface TsconfigCompilerOptions {
  paths?: Record<string, string[]>
  types?: unknown
}
const syncConfigs = async (selfPath: string, projectPath: string): Promise<Issue[]> => {
  const managed = await resolveManagedFiles(projectPath)
  const results = await Promise.all(
    managed.map(async ({ extendable, path: name }) => {
      const src = file(join(selfPath, name))
      const dst = file(join(projectPath, name))
      if (!(await src.exists())) return
      const srcContent = await src.text()
      const dstContent = (await dst.exists()) ? await dst.text() : ''
      if (extendable && isExtended(srcContent, dstContent)) return
      const nextContent = extendable && dstContent !== '' ? mergeExtendable(srcContent, dstContent) : srcContent
      if (nextContent !== dstContent) {
        await write(dst, nextContent)
        return { detail: `${name} updated`, type: 'synced' } satisfies Issue
      }
    })
  )
  const stale = await staleConditionalFiles(projectPath)
  const removals = await Promise.all(
    stale.map(async name => {
      const dst = join(projectPath, name)
      if (!(await file(dst).exists())) return
      await rm(dst)
      return { detail: `${name} removed — no longer applies to this project`, type: 'synced' } satisfies Issue
    })
  )
  return [...results, ...removals].filter((r): r is Issue => r !== undefined)
}
const ANY_HEADING_RE = /^#{1,6} /u
/** The formatter puts a blank line on both sides of every heading outside a code fence, so the generator emits that shape and its output is already a fixed point under `bun run fix`. */
const spaceHeadings = (text: string): string => {
  const out: string[] = []
  let isInFence = false
  let afterHeading = false
  for (const line of text.split('\n')) {
    if (FENCE_RE.test(line)) isInFence = !isInFence
    const heading = !isInFence && ANY_HEADING_RE.test(line)
    if ((heading || afterHeading) && line !== '' && out.length > 0 && out.at(-1) !== '') out.push('')
    out.push(line)
    afterHeading = heading
  }
  return out.join('\n')
}
/** Single source for the generated CLAUDE.md — one doc title, a Contents list, then each rule as a `##` topic. `fix` writes what this returns; the freshness check diffs against it, so neither can drift from the other. */
const generateClaudeMd = async (selfPath: string, projectPath: string): Promise<GeneratedGuide> => {
  const rulesDir = join(selfPath, 'apps', 'docs', 'content', 'rules')
  if (!(await doesPathExist(rulesDir))) return { error: 'rules directory not found in pm4ai repo' }
  const inferred = await inferRules(projectPath, rulesDir)
  const contents = await Promise.all(inferred.map(async rule => file(join(rulesDir, `${rule}.mdx`)).text()))
  const titles = contents.map(c => frontmatterTitle(c)).filter((t): t is string => Boolean(t))
  const header = `# ${GUIDE_TITLE}\n\n${buildContents(titles)}`
  const blocks = contents.map(c => ruleBlock(c))
  const raw = `${[header, ...blocks].join('\n\n---\n\n')}\n`
  return { content: spaceHeadings(raw) }
}
const SMART_SINGLE_RE = /[‘’]/gu
const SMART_DOUBLE_RE = /[“”]/gu
const WS_RE = /\s/gu
/** The generator emits raw markdown; the project's own `bun run fix` (lintmax) then canonicalizes the written file (smart quotes, and it even deletes spaces around inline-code spans). Reduce both to a whitespace-free, quote-folded content signature so a real content drift is caught while any cosmetic reformat — including that space-deletion — is not. */
const normalizeGuide = (s: string): string =>
  s.replaceAll(SMART_SINGLE_RE, "'").replaceAll(SMART_DOUBLE_RE, '"').replaceAll(WS_RE, '')
const lintmaxBinOf = (p: string): string => join(p, 'node_modules', '.bin', 'lintmax')
const ancestorLintmaxBin = async (start: string): Promise<string | undefined> => {
  const dirs: string[] = []
  for (let dir = start; ; dir = dirname(dir)) {
    dirs.push(dir)
    if (dirname(dir) === dir) break
  }
  const candidates = dirs.map(d => lintmaxBinOf(d))
  const present = await Promise.all(candidates.map(async c => doesPathExist(c)))
  return candidates[present.indexOf(true)]
}
const resolveLintmaxBin = async (projectPath: string, selfPath: string): Promise<string | undefined> => {
  const projectBin = lintmaxBinOf(projectPath)
  const selfBin = lintmaxBinOf(selfPath)
  if (await doesPathExist(projectBin)) return projectBin
  if (await doesPathExist(selfBin)) return selfBin
  const ancestorBin = await ancestorLintmaxBin(import.meta.dirname)
  return ancestorBin
}
const runClaudeMdCanonicalizer = async (projectPath: string, lintmaxBin: string): Promise<string | undefined> => {
  try {
    const proc = spawn([lintmaxBin, 'fix', CLAUDE_MD], {
      cwd: projectPath,
      stderr: 'pipe',
      stdin: 'ignore',
      stdout: 'pipe',
      timeout: 120_000
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text()
    ])
    if (exitCode !== 0)
      return `${CLAUDE_MD} canonicalize failed: lintmax fix ${CLAUDE_MD} exited ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`
  } catch (error) {
    return `${CLAUDE_MD} canonicalize failed: ${String(error)}`
  }
}
const canonicalizeClaudeMd = async (projectPath: string, selfPath: string): Promise<string | undefined> => {
  const lintmaxBin = await resolveLintmaxBin(projectPath, selfPath)
  if (lintmaxBin === undefined) return `${CLAUDE_MD} canonicalize failed: lintmax binary not found`
  const error = await runClaudeMdCanonicalizer(projectPath, lintmaxBin)
  return error
}
const syncClaudeMd = async (selfPath: string, projectPath: string, shouldDeferCanonicalize = false): Promise<Issue[]> => {
  const result = await generateClaudeMd(selfPath, projectPath)
  if (result.error !== undefined || result.content === undefined)
    return [{ detail: result.error ?? 'generate failed', type: 'error' }]
  const claudeFile = file(join(projectPath, CLAUDE_MD))
  const existing = (await claudeFile.exists()) ? await claudeFile.text() : ''
  if (normalizeGuide(result.content) === normalizeGuide(existing)) return []
  await write(claudeFile, result.content)
  const canonicalizeError = shouldDeferCanonicalize ? undefined : await canonicalizeClaudeMd(projectPath, selfPath)
  if (canonicalizeError !== undefined) return [{ detail: canonicalizeError, type: 'error' }]
  return [{ detail: `${CLAUDE_MD} updated`, type: 'synced' }]
}
/** Read-only freshness gate for status: regenerate in memory and diff, so a CLAUDE.md that drifted from its source rules fails the gate instead of reading green fleet-wide. */
const checkClaudeMdFresh = async (selfPath: string, projectPath: string): Promise<Issue[]> => {
  const result = await generateClaudeMd(selfPath, projectPath)
  if (result.error !== undefined || result.content === undefined) return []
  const claudeFile = file(join(projectPath, CLAUDE_MD))
  const existing = (await claudeFile.exists()) ? await claudeFile.text() : ''
  if (normalizeGuide(result.content) === normalizeGuide(existing)) return []
  return [{ detail: `${CLAUDE_MD} stale — run pm4ai fix to regenerate from current rules`, type: 'file' }]
}
const isLintmaxScriptCanonical = (script: string | undefined, fallback: string, command: 'check' | 'fix'): boolean => {
  const value = script ?? ''
  return value.endsWith(fallback) || value.endsWith(`cli.js ${command}`) || value.endsWith(`cli.mjs ${command}`)
}
const doesRootScriptNeedUpdate = (scripts: Record<string, string>, name: string, value: string): boolean => {
  if (name === 'fix' || name === 'check') return !isLintmaxScriptCanonical(scripts[name], value, name)
  if (name === 'clean') return !scripts[name]?.startsWith(value)
  return scripts[name] !== value
}
const TURBO_SEGMENT_RE =
  /(?<wrapped>bash -c "[^"\n]*\bturbo\b[^"\n]* 2> >\(grep -vE '[^'\n]*' >&2\)")|(?<command>\bturbo\b[^&|;"\n]*)/gu
const TURBO_FILTER_TEXT_RE = /(?<=grep -vE ')[^']*/u
const syncTurboSegment = (match: string, wrapped: string | undefined, command: string | undefined): string => {
  if (wrapped) return wrapped.replace(TURBO_FILTER_TEXT_RE, () => TURBO_WARNING_FILTER)
  if (!command?.includes(TURBO_FLAG)) return match
  const trimmed = command.trimEnd()
  return `${filterTurboWorkspaceWarning(trimmed)}${command.slice(trimmed.length)}`
}
const didSyncTurboWarningFilter = (scripts: Record<string, string>, issues: Issue[]): boolean => {
  const targets = Object.entries(scripts)
    .filter(([name, cmd]) => !name.startsWith('dev') && cmd.includes('turbo') && cmd.includes(TURBO_FLAG))
    .map(([name, cmd]) => ({ cmd, name, next: cmd.replaceAll(TURBO_SEGMENT_RE, syncTurboSegment) }))
    .filter(({ cmd, next }) => next !== cmd)
  for (const { name, next } of targets) {
    scripts[name] = next
    issues.push({ detail: `updated ${name} script to filter turbo workspace warning`, type: 'synced' })
  }
  return targets.length > 0
}
const didSyncPostinstall = (scripts: Record<string, string>, issues: Issue[]): boolean => {
  if (scripts.postinstall?.includes('sherif')) return false
  scripts.postinstall = scripts.postinstall ? `${scripts.postinstall} && sherif` : DEFAULT_SCRIPTS.postinstall
  issues.push({ detail: 'added sherif to postinstall', type: 'synced' })
  return true
}
interface RootScriptArgs {
  issues: Issue[]
  name: string
  scripts: Record<string, string>
  value: string
}
const didSyncRootScript = ({ issues, name, scripts, value }: RootScriptArgs): boolean => {
  if (name === 'postinstall') return didSyncPostinstall(scripts, issues)
  if (!doesRootScriptNeedUpdate(scripts, name, value)) return false
  const action = scripts[name] ? 'updated' : 'added'
  scripts[name] = value
  issues.push({ detail: `${action} ${name} script`, type: 'synced' })
  return true
}
const didSyncRootScripts = (scripts: Record<string, string>, issues: Issue[]): boolean => {
  let hasChanged = false
  for (const [name, value] of Object.entries(DEFAULT_SCRIPTS))
    if (didSyncRootScript({ issues, name, scripts, value })) hasChanged = true
  const isTurboChanged = didSyncTurboWarningFilter(scripts, issues)
  return hasChanged || isTurboChanged
}
/** Ask the registry whether any PUBLISHED version satisfies the spec. A deliberate pin that still resolves is left alone; only a spec nothing can satisfy — the shape a single-present-release package leaves behind when its pinned version is pruned — is rewritten. */
const doesResolveOnRegistry = async (dep: string, spec: string): Promise<boolean> => {
  const target = `${dep}@${spec}`
  const res = await $`npm view ${target} version`.quiet().nothrow()
  return res.exitCode === 0 && res.stdout.toString().trim().length > 0
}
interface ApplyRootDevDepsArgs {
  allDeps: Record<string, string>
  devDeps: Record<string, string>
  issues: Issue[]
  verdicts: boolean[]
}
const didApplyRootDevDeps = ({ allDeps, devDeps, issues, verdicts }: ApplyRootDevDepsArgs): boolean => {
  const targets = REQUIRED_ROOT_DEVDEPS.map((dep, index) => ({
    dep,
    isUnresolvable: verdicts[index] ?? false,
    spec: allDeps[dep]
  })).filter(({ isUnresolvable, spec }) => !spec || isUnresolvable)
  for (const { dep, isUnresolvable, spec } of targets) {
    devDeps[dep] = DEFAULT_DEP_VERSION
    issues.push({
      detail: isUnresolvable
        ? `unresolvable ${dep} "${spec}" rewritten to "${DEFAULT_DEP_VERSION}"`
        : `added ${dep} to devDependencies`,
      type: 'synced'
    })
  }
  return targets.length > 0
}
const didSyncRootDevDeps = async (
  pkg: PackageJson,
  devDeps: Record<string, string>,
  issues: Issue[]
): Promise<boolean> => {
  const allDeps = { ...pkg.dependencies, ...devDeps }
  const verdicts = await Promise.all(
    REQUIRED_ROOT_DEVDEPS.map(async dep => {
      const spec = allDeps[dep]
      const isCandidate =
        Boolean(spec) &&
        spec !== DEFAULT_DEP_VERSION &&
        !spec.startsWith('workspace:') &&
        Boolean(pkg.devDependencies?.[dep])
      return isCandidate && !(await doesResolveOnRegistry(dep, spec))
    })
  )
  return didApplyRootDevDeps({ allDeps, devDeps, issues, verdicts })
}
const didSetPrivate = (pkg: PackageJson, issues: Issue[]): boolean => {
  if (pkg.private) return false
  pkg.private = true
  issues.push({ detail: 'set root package.json to private', type: 'synced' })
  return true
}
const didAddHooks = (pkg: PackageJson, issues: Issue[]): boolean => {
  if (pkg['simple-git-hooks']) return false
  pkg['simple-git-hooks'] = { 'pre-commit': EXPECTED.preCommit }
  issues.push({ detail: 'added simple-git-hooks', type: 'synced' })
  return true
}
const didSyncRootBasics = (pkg: PackageJson, issues: Issue[]): boolean => {
  const isPrivateSet = didSetPrivate(pkg, issues)
  const scripts = pkg.scripts ?? {}
  pkg.scripts = scripts
  const areHooksAdded = didAddHooks(pkg, issues)
  return didSyncRootScripts(scripts, issues) || isPrivateSet || areHooksAdded
}
interface FindRedundantArgs {
  devDeps: Record<string, string>
  pkg: PackageJson
  projectPath: string
}
interface RedundantDevDep {
  depName: string
  other: string
}
const findRedundantDevDeps = async ({ devDeps, pkg, projectPath }: FindRedundantArgs): Promise<RedundantDevDep[]> => {
  const allRootDepNames = Object.keys({ ...pkg.dependencies, ...devDeps })
  const required = new Set(REQUIRED_ROOT_DEVDEPS)
  const depPkgs = await Promise.all(
    allRootDepNames.map(async depName => {
      const depPkg = await readPkg(join(projectPath, 'node_modules', depName, 'package.json'))
      return depPkg ? [{ depName, transitive: depPkg.dependencies ?? {} }] : []
    })
  )
  const pairs = depPkgs
    .flat()
    .flatMap(dep =>
      allRootDepNames
        .filter(
          other =>
            other !== dep.depName && Boolean(dep.transitive[other]) && Boolean(devDeps[other]) && !required.has(other)
        )
        .map(other => ({ depName: dep.depName, other }))
    )
  return pairs.filter((pair, index) => pairs.findIndex(p => p.other === pair.other) === index)
}
const didDropRootDevDeps = (pkg: PackageJson, redundant: RedundantDevDep[], issues: Issue[]): boolean => {
  if (redundant.length === 0) return false
  const names = new Set(redundant.map(r => r.other))
  pkg.devDependencies = Object.fromEntries(Object.entries(pkg.devDependencies ?? {}).filter(([n]) => !names.has(n)))
  issues.push(
    ...redundant.map(
      ({ depName, other }): Issue => ({ detail: `removed redundant "${other}" (provided by ${depName})`, type: 'synced' })
    )
  )
  return true
}
const bunVersionText = async (): Promise<string> => {
  const r = await $`bun --version`.quiet().nothrow()
  return r.stdout.toString().trim()
}
const didSetPackageManager = (pkg: PackageJson, issues: Issue[], bunVersion: string): boolean => {
  if (pkg.packageManager || !bunVersion) return false
  pkg.packageManager = `bun@${bunVersion}`
  issues.push({ detail: `set packageManager to bun@${bunVersion}`, type: 'synced' })
  return true
}
const readRequiredTrusted = async (selfPath?: string): Promise<string[]> => {
  if (!selfPath) return []
  const selfPkg = parseJson<PackageJson>(await file(join(selfPath, 'package.json')).text())
  return selfPkg.trustedDependencies ?? []
}
const didSyncTrusted = (pkg: PackageJson, requiredTrusted: string[], issues: Issue[]): boolean => {
  const trusted = pkg.trustedDependencies ?? []
  const missingTrusted = requiredTrusted.filter(d => !trusted.includes(d))
  if (missingTrusted.length === 0) return false
  pkg.trustedDependencies = [...trusted, ...missingTrusted].toSorted((a, b) => (a < b ? -1 : Number(a > b)))
  issues.push({ detail: `added ${missingTrusted.join(', ')} to trustedDependencies`, type: 'synced' })
  return true
}
const didSetActionScript = (scripts: Record<string, string>, issues: Issue[]): boolean => {
  if (scripts.action?.includes('sh up.sh')) return false
  scripts.action = scripts.action ? `sh up.sh && ${scripts.action}` : 'sh up.sh'
  issues.push({ detail: 'action must run "sh up.sh"', type: 'synced' })
  return true
}
interface SyncRootPkgArgs {
  issues: Issue[]
  pkg: PackageJson
  projectPath: string
  selfPath?: string
}
const didSyncRootSettings = async ({ issues, pkg, selfPath }: SyncRootPkgArgs): Promise<boolean> => {
  const requiredTrusted = await readRequiredTrusted(selfPath)
  const isTrustedSynced = didSyncTrusted(pkg, requiredTrusted, issues)
  const isActionSet = didSetActionScript(pkg.scripts ?? {}, issues)
  return isActionSet || isTrustedSynced
}
const didSyncRootPkg = async ({ issues, pkg, projectPath, selfPath }: SyncRootPkgArgs): Promise<boolean> => {
  const areBasicsChanged = didSyncRootBasics(pkg, issues)
  const devDeps = pkg.devDependencies ?? {}
  pkg.devDependencies = devDeps
  const areDevDepsSynced = await didSyncRootDevDeps(pkg, devDeps, issues)
  const redundant = await findRedundantDevDeps({ devDeps, pkg, projectPath })
  const isDeduped = didDropRootDevDeps(pkg, redundant, issues)
  const bunVersion = await bunVersionText()
  const isPackageManagerSet = didSetPackageManager(pkg, issues, bunVersion)
  const areSettingsChanged = await didSyncRootSettings({ issues, pkg, projectPath, selfPath })
  return [areBasicsChanged, areDevDepsSynced, areSettingsChanged, isDeduped, isPackageManagerSet].includes(true)
}
const syncPackageJson = async (projectPath: string, selfPath?: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const pkgPath = join(projectPath, 'package.json')
  const pkg = await readPkg(pkgPath)
  if (!pkg) return issues
  if (await didSyncRootPkg({ issues, pkg, projectPath, selfPath })) {
    pkg.devDependencies = sortKeys(pkg.devDependencies ?? {})
    await writeJson(pkgPath, pkg)
  }
  return issues
}
const didRemoveInclude = (tsconfig: Record<string, unknown>, issues: Issue[]): boolean => {
  if (!('include' in tsconfig)) return false
  delete tsconfig.include
  issues.push({ detail: 'removed "include" from root tsconfig.json', type: 'synced' })
  return true
}
const didSetExtends = (tsconfig: Record<string, unknown>, issues: Issue[]): boolean => {
  if (tsconfig.extends === EXPECTED.tsconfigExtends) return false
  tsconfig.extends = EXPECTED.tsconfigExtends
  issues.push({ detail: `set tsconfig extends to "${EXPECTED.tsconfigExtends}"`, type: 'synced' })
  return true
}
const didAddBunTypes = (tsconfig: Record<string, unknown>, issues: Issue[]): boolean => {
  if (getTsconfigTypes(tsconfig)?.includes('bun-types')) return false
  /** biome-ignore lint/nursery/noUnsafeTypeAssertion: compilerOptions is read from validated tsconfig JSON */
  const co = (tsconfig.compilerOptions ?? {}) as MutableCompilerOptions
  co.types = ['bun-types']
  tsconfig.compilerOptions = co
  issues.push({ detail: 'added "bun-types" to tsconfig compilerOptions.types', type: 'synced' })
  return true
}
const updateTsconfig = async (tsconfigPath: string, tsconfig: Record<string, unknown>, issues: Issue[]): Promise<void> => {
  const changes = [didRemoveInclude(tsconfig, issues), didSetExtends(tsconfig, issues), didAddBunTypes(tsconfig, issues)]
  if (changes.includes(true)) await writeJson(tsconfigPath, tsconfig)
}
const syncTsconfig = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const tsconfigPath = join(projectPath, 'tsconfig.json')
  const tsconfig = await readJson(tsconfigPath)
  if (tsconfig) await updateTsconfig(tsconfigPath, tsconfig, issues)
  return issues
}
interface FixPublishedPkgArgs {
  issues: Issue[]
  pkg: PackageJson
  pkgPath: string
  rel: string
  repo: string | undefined
}
const distPrefixRe = /^\.?\/?dist\//u
const dotSlashRe = /^\.\//u
const mjsExtRe = /\.mjs$/u
const monorepoRootRe = /\/(?:packages|tool|lib)\/[^/]+$/u
const resolveExportSource = async (key: string, importPath: string, pkgDir: string): Promise<string | undefined> => {
  if (importPath.endsWith('.json')) return
  const srcBase = key === '.' ? 'src/index' : `src/${key.replace(dotSlashRe, '')}`
  for (const ext of ['.ts', '.tsx']) {
    // eslint-disable-next-line no-await-in-loop
    const doesSrcExist = await doesPathExist(join(pkgDir, `${srcBase}${ext}`))
    if (doesSrcExist) return `${srcBase}${ext}`
  }
}
interface ExportResolution {
  copy?: string
  entry?: string
  isUnresolved: boolean
}
interface TsdownConfig {
  copy?: string[]
  entry: string[]
}
const resolveExport = async (
  key: string,
  val: Record<string, string> | string,
  pkgDir: string
): Promise<ExportResolution> => {
  const importPath = typeof val === 'string' ? val : (val.import ?? val.default)
  if (!importPath) return { isUnresolved: false }
  if (importPath.endsWith('.css')) {
    const srcCss = importPath.replace(distPrefixRe, 'src/')
    return (await doesPathExist(join(pkgDir, srcCss))) ? { copy: srcCss, isUnresolved: false } : { isUnresolved: false }
  }
  const src = await resolveExportSource(key, importPath, pkgDir)
  return src ? { entry: src, isUnresolved: false } : { isUnresolved: true }
}
const resolveBinEntries = async (pkg: PackageJson, pkgDir: string): Promise<string[]> => {
  if (!pkg.bin) return []
  const bins = typeof pkg.bin === 'string' ? { default: pkg.bin } : pkg.bin
  const srcPaths = Object.values(bins).map(binPath => binPath.replace(distPrefixRe, 'src/').replace(mjsExtRe, '.ts'))
  const present = await Promise.all(srcPaths.map(async srcPath => doesPathExist(join(pkgDir, srcPath))))
  return srcPaths.filter((_, index) => present[index])
}
const resolveIndexEntry = async (pkgDir: string): Promise<string[]> => {
  const doesIndexTsExist = await doesPathExist(join(pkgDir, 'src/index.ts'))
  const doesIndexTsxExist = await doesPathExist(join(pkgDir, 'src/index.tsx'))
  if (doesIndexTsExist) return ['src/index.ts']
  return doesIndexTsxExist ? ['src/index.tsx'] : []
}
const inferTsdownConfig = async (pkg: PackageJson, pkgDir: string): Promise<TsdownConfig | undefined> => {
  const exportResults = await Promise.all(
    Object.entries(pkg.exports ?? {}).map(async ([key, val]) => resolveExport(key, val, pkgDir))
  )
  if (exportResults.some(r => r.isUnresolved)) return
  const exportEntries = exportResults.flatMap(r => (r.entry === undefined ? [] : [r.entry]))
  const copy = exportResults.flatMap(r => (r.copy === undefined ? [] : [r.copy]))
  const merged = [...exportEntries, ...(await resolveBinEntries(pkg, pkgDir))]
  const withBins = merged.filter((path, index) => index < exportEntries.length || merged.indexOf(path) === index)
  const entry = withBins.length === 0 && !pkg.bin ? await resolveIndexEntry(pkgDir) : withBins
  if (entry.length === 0) return
  return copy.length > 0 ? { copy, entry } : { entry }
}
const quoteList = (items: readonly string[]): string => items.map(i => `'${i}'`).join(', ')
const serializeTsdownConfig = (config: TsdownConfig): string => {
  const fields = [
    `  clean: ${TSDOWN_BASE.clean},`,
    `  deps: { neverBundle: [${quoteList(TSDOWN_BASE.deps.neverBundle)}] },`,
    `  dts: ${TSDOWN_BASE.dts},`
  ]
  if (config.copy) fields.push(`  copy: [${quoteList(config.copy)}],`)
  fields.push(
    `  entry: [${quoteList(config.entry)}],`,
    `  format: '${TSDOWN_BASE.format}',`,
    `  outDir: '${TSDOWN_BASE.outDir}'`
  )
  return `import { defineConfig } from 'tsdown'\n\nexport default defineConfig({\n${fields.join('\n')}\n})\n`
}
const isSymlinkPath = async (path: string): Promise<boolean> => {
  try {
    await readlink(path)
    return true
  } catch {
    return false
  }
}
const isReadmeCurrent = async (readmeDst: string, srcContent: string): Promise<boolean> => {
  if (!(await doesPathExist(readmeDst))) return false
  const isSymlink = await isSymlinkPath(readmeDst)
  if (!isSymlink && (await file(readmeDst).text()) === srcContent) return true
  if (isSymlink) await rm(readmeDst)
  return false
}
const didSyncReadmeSymlink = async ({
  issues,
  monorepoRoot,
  pkgDir,
  rel
}: {
  issues: Issue[]
  monorepoRoot: string
  pkgDir: string
  rel: string
}): Promise<boolean> => {
  const readmeSrc = join(monorepoRoot, 'README.md')
  const readmeDst = join(pkgDir, 'README.md')
  const srcFile = file(readmeSrc)
  if (!(await srcFile.exists())) return false
  const srcContent = await srcFile.text()
  if (await isReadmeCurrent(readmeDst, srcContent)) return false
  await write(readmeDst, srcContent)
  issues.push({ detail: `${rel} synced README.md`, type: 'synced' })
  return true
}
const PRUNE_POSTPUBLISH = 'bun ../../tools/prune-versions.ts'
/** A package that is no longer published keeps the postpublish prune hook fixPublishedPkg set while it WAS
 * published — a script pointing at the tools/prune-versions.ts that syncConfigs now removes, so leaving it
 * dangles the reference. Remove only the pm4ai-set hook, never a project's own custom postpublish. */
const didRemoveStalePublishScripts = (pkg: PackageJson, rel: string, issues: Issue[]): boolean => {
  const { scripts } = pkg
  if (scripts?.postpublish !== PRUNE_POSTPUBLISH) return false
  delete scripts.postpublish
  if (Object.keys(scripts).length === 0) delete pkg.scripts
  issues.push({ detail: `${rel} removed stale postpublish prune hook`, type: 'synced' })
  return true
}
const didSetModuleType = ({ issues, pkg, rel }: FixPublishedPkgArgs): boolean => {
  if (pkg.type === 'module') return false
  pkg.type = 'module'
  issues.push({ detail: `${rel} set "type": "module"`, type: 'synced' })
  return true
}
const didSetFiles = ({ issues, pkg, rel }: FixPublishedPkgArgs): boolean => {
  if (pkg.files) return false
  pkg.files = DEFAULT_FILES
  issues.push({ detail: `${rel} set "files": ${JSON.stringify(DEFAULT_FILES)}`, type: 'synced' })
  return true
}
const didSetLicense = ({ issues, pkg, rel }: FixPublishedPkgArgs): boolean => {
  if (pkg.license) return false
  pkg.license = DEFAULT_LICENSE
  issues.push({ detail: `${rel} set "license": "${DEFAULT_LICENSE}"`, type: 'synced' })
  return true
}
const didSetRepository = ({ issues, pkg, rel, repo }: FixPublishedPkgArgs): boolean => {
  if (pkg.repository || !repo) return false
  pkg.repository = { directory: dirname(rel), type: 'git', url: `https://github.com/${repo}` }
  issues.push({ detail: `${rel} added repository`, type: 'synced' })
  return true
}
const didSetBuildScript = ({ issues, pkg, rel }: FixPublishedPkgArgs, pubScripts: Record<string, string>): boolean => {
  if (!pubScripts.build || pubScripts.build === 'tsdown') return false
  pubScripts.build = 'tsdown'
  pkg.scripts = pubScripts
  issues.push({ detail: `${rel} set build to "tsdown"`, type: 'synced' })
  return true
}
const syncTsdownConfig = async ({ issues, pkg, pkgPath, rel }: FixPublishedPkgArgs): Promise<void> => {
  const pkgDir = dirname(pkgPath)
  const tsdownConfigPath = join(pkgDir, 'tsdown.config.ts')
  const tsdownConfig = await inferTsdownConfig(pkg, pkgDir)
  if (!tsdownConfig) return
  const existingContent = (await doesPathExist(tsdownConfigPath)) ? await file(tsdownConfigPath).text() : ''
  if (existingContent.includes('dts: false') || existingContent.includes('onSuccess')) return
  const generatedContent = serializeTsdownConfig(tsdownConfig)
  if (existingContent === generatedContent) return
  await write(tsdownConfigPath, generatedContent)
  issues.push({ detail: `${rel} generated tsdown.config.ts`, type: 'synced' })
}
interface PublishScriptPlan {
  willSetPostpublish: boolean
  willSetPrepublish: boolean
}
const applyPublishScripts = (
  { issues, rel }: FixPublishedPkgArgs,
  pubScripts: Record<string, string>,
  plan: PublishScriptPlan
): void => {
  if (plan.willSetPostpublish) {
    pubScripts.postpublish = PRUNE_POSTPUBLISH
    delete pubScripts['cleanup-old-versions']
    issues.push({ detail: `${rel} set postpublish to prune-versions script`, type: 'synced' })
  }
  if (plan.willSetPrepublish) {
    pubScripts.prepublishOnly = 'bun run build'
    issues.push({ detail: `${rel} set prepublishOnly to always build before publish`, type: 'synced' })
  }
}
const didFixPublishedPkg = async (args: FixPublishedPkgArgs): Promise<boolean> => {
  const pubScripts = args.pkg.scripts ?? {}
  const isMetaChanged = [
    didSetBuildScript(args, pubScripts),
    didSetFiles(args),
    didSetLicense(args),
    didSetModuleType(args),
    didSetRepository(args)
  ].includes(true)
  const plan: PublishScriptPlan = {
    willSetPostpublish: pubScripts.postpublish !== PRUNE_POSTPUBLISH,
    willSetPrepublish: Boolean(pubScripts.build) && pubScripts.prepublishOnly !== 'bun run build'
  }
  if (plan.willSetPostpublish || plan.willSetPrepublish) args.pkg.scripts = pubScripts
  await syncTsdownConfig(args)
  const pkgDir = dirname(args.pkgPath)
  await didSyncReadmeSymlink({
    issues: args.issues,
    monorepoRoot: pkgDir.replace(monorepoRootRe, ''),
    pkgDir,
    rel: args.rel
  })
  applyPublishScripts(args, pubScripts, plan)
  return isMetaChanged || plan.willSetPostpublish || plan.willSetPrepublish
}
const didFixGitClean = (pkg: PackageJson, rel: string, issues: Issue[]): boolean => {
  const scripts = pkg.scripts ?? {}
  const targets = Object.entries(scripts).filter(([, cmd]) => {
    gitCleanRe.lastIndex = 0
    return gitCleanRe.test(cmd)
  })
  for (const [name, cmd] of targets) {
    gitCleanRe.lastIndex = 0
    scripts[name] = cmd.replace(gitCleanRe, 'rm -rf ')
    issues.push({ detail: `${rel} "${name}" replaced git clean with rm -rf`, type: 'synced' })
  }
  return targets.length > 0
}
interface HoistArgs {
  issues: Issue[]
  rel: string
  rootDevDeps: Record<string, string>
  subDevDeps: Record<string, string>
}
const hoistDevDeps = ({
  issues,
  rel,
  rootDevDeps,
  subDevDeps
}: HoistArgs): { hoisted: boolean; remaining: Record<string, string> | undefined } => {
  const external = Object.entries(subDevDeps).filter(([, v]) => !v.startsWith('workspace:'))
  if (external.length === 0)
    return { hoisted: false, remaining: Object.keys(subDevDeps).length === 0 ? undefined : subDevDeps }
  const toHoist = external.filter(([name]) => !rootDevDeps[name])
  for (const [name, version] of toHoist) {
    rootDevDeps[name] = version
    issues.push({ detail: `hoisted ${name} from ${rel} to root`, type: 'synced' })
  }
  const ws = Object.fromEntries(Object.entries(subDevDeps).filter(([, v]) => v.startsWith('workspace:')))
  return { hoisted: toHoist.length > 0, remaining: Object.keys(ws).length === 0 ? undefined : ws }
}
interface FixSubEntryArgs {
  entry: { path: string; pkg: PackageJson }
  issues: Issue[]
  projectPath: string
  repo: string | undefined
}
const didSetAppPrivate = (pkg: PackageJson, rel: string, issues: Issue[]): boolean => {
  if (!rel.startsWith('apps/') || pkg.private) return false
  pkg.private = true
  issues.push({ detail: `${rel} set to private`, type: 'synced' })
  return true
}
const didRemoveCleanScript = (pkg: PackageJson, rel: string, issues: Issue[]): boolean => {
  const { scripts } = pkg
  if (!scripts?.clean) return false
  delete scripts.clean
  if (Object.keys(scripts).length === 0) delete pkg.scripts
  issues.push({ detail: `${rel} removed redundant "clean" script`, type: 'synced' })
  return true
}
const didFixSubEntry = async ({ entry, issues, projectPath, repo }: FixSubEntryArgs): Promise<boolean> => {
  const rel = entry.path.replace(`${projectPath}/`, '')
  if (isSkippedPath(rel)) return false
  const isPrivateSet = didSetAppPrivate(entry.pkg, rel, issues)
  const isPubChanged = isPublishedPkg(entry.pkg)
    ? await didFixPublishedPkg({ issues, pkg: entry.pkg, pkgPath: entry.path, rel, repo })
    : didRemoveStalePublishScripts(entry.pkg, rel, issues)
  const isCleanRemoved = didRemoveCleanScript(entry.pkg, rel, issues)
  return didFixGitClean(entry.pkg, rel, issues) || isPrivateSet || isPubChanged || isCleanRemoved
}
interface HoistSubEntryArgs {
  entry: { path: string; pkg: PackageJson }
  issues: Issue[]
  projectPath: string
  rootDevDeps: Record<string, string>
}
const hoistSubEntry = ({
  entry,
  issues,
  projectPath,
  rootDevDeps
}: HoistSubEntryArgs): { changed: boolean; hoisted: boolean; pkg: PackageJson; pkgPath: string } => {
  const rel = entry.path.replace(`${projectPath}/`, '')
  const originalDevDeps = entry.pkg.devDependencies
  const { hoisted, remaining } = hoistDevDeps({ issues, rel, rootDevDeps, subDevDeps: originalDevDeps ?? {} })
  const isChanged = remaining !== originalDevDeps && !(remaining === undefined && !originalDevDeps)
  if (isChanged) entry.pkg.devDependencies = remaining
  return { changed: isChanged, hoisted, pkg: entry.pkg, pkgPath: entry.path }
}
interface DedupeFieldArgs {
  entry: WorkspaceEntry
  field: DepField
  issues: Issue[]
  providedByWs: Set<string>
  rel: string
}
interface WorkspaceEntry {
  path: string
  pkg: PackageJson
}
const didDedupeField = ({ entry, field, issues, providedByWs, rel }: DedupeFieldArgs): boolean => {
  const deps = entry.pkg[field]
  if (!deps) return false
  const duplicates = Object.entries(deps)
    .filter(([name, version]) => !version.startsWith('workspace:') && providedByWs.has(name))
    .map(([name]) => name)
  issues.push(
    ...duplicates.map(
      (name): Issue => ({ detail: `${rel} removed duplicate "${name}" (provided by workspace dep)`, type: 'synced' })
    )
  )
  const kept = Object.entries(deps).filter(([name]) => !duplicates.includes(name))
  if (kept.length === 0) Reflect.deleteProperty(entry.pkg, field)
  else if (duplicates.length > 0) entry.pkg[field] = Object.fromEntries(kept)
  return duplicates.length > 0
}
interface DedupeEntryArgs {
  entry: WorkspaceEntry
  issues: Issue[]
  pkgDepsByName: Map<string, Set<string>>
  projectPath: string
}
const didDedupeEntry = ({ entry, issues, pkgDepsByName, projectPath }: DedupeEntryArgs): boolean => {
  const rel = entry.path.replace(`${projectPath}/`, '')
  const allDeps = [...Object.entries(entry.pkg.dependencies ?? {}), ...Object.entries(entry.pkg.devDependencies ?? {})]
  const wsDeps = allDeps.filter(([, v]) => v.startsWith('workspace:')).map(([n]) => n)
  const providedByWs = providedByWorkspaces(wsDeps, pkgDepsByName)
  return DEP_FIELDS.map(field => didDedupeField({ entry, field, issues, providedByWs, rel })).includes(true)
}
const isDedupeTarget = (entry: WorkspaceEntry, projectPath: string): boolean => {
  const rel = entry.path.replace(`${projectPath}/`, '')
  return !(isSkippedPath(rel) || rel.startsWith('apps/'))
}
interface HoistRootArgs {
  issues: Issue[]
  projectPath: string
  rootPkgPath: string
  subEntries: WorkspaceEntry[]
}
const hoistRootDevDeps = async ({ issues, projectPath, rootPkgPath, subEntries }: HoistRootArgs): Promise<void> => {
  const rootPkg = await readPkg(rootPkgPath)
  if (!rootPkg) return
  const rootDevDeps = rootPkg.devDependencies ?? {}
  const results = subEntries
    .filter(e => !isSkippedPath(e.path.replace(`${projectPath}/`, '')))
    .map(entry => hoistSubEntry({ entry, issues, projectPath, rootDevDeps }))
  await Promise.all(results.filter(r => r.changed).map(async r => writeJson(r.pkgPath, r.pkg)))
  if (results.every(r => !r.hoisted)) return
  rootPkg.devDependencies = sortKeys(rootDevDeps)
  await writeJson(rootPkgPath, rootPkg)
}
interface DedupeSubEntriesArgs {
  entries: WorkspaceEntry[]
  issues: Issue[]
  projectPath: string
  subEntries: WorkspaceEntry[]
}
const dedupeSubEntries = ({ entries, issues, projectPath, subEntries }: DedupeSubEntriesArgs): Promise<number>[] => {
  const pkgDepsByName = buildPkgDepMap(entries)
  return subEntries
    .filter(entry => isDedupeTarget(entry, projectPath))
    .filter(entry => didDedupeEntry({ entry, issues, pkgDepsByName, projectPath }))
    .map(async entry => writeJson(entry.path, entry.pkg))
}
const syncSubPackages = async (_selfPath: string, projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const entries = await collectWorkspacePackages(projectPath)
  const rootPkgPath = join(projectPath, 'package.json')
  const repo = await getGhRepo(projectPath)
  const subEntries = entries.filter(e => e.path !== rootPkgPath)
  const fixed = await Promise.all(
    subEntries.map(async entry => ({ changed: await didFixSubEntry({ entry, issues, projectPath, repo }), entry }))
  )
  const writes = fixed.filter(f => f.changed).map(async f => writeJson(f.entry.path, f.entry.pkg))
  await Promise.all([...writes, ...dedupeSubEntries({ entries, issues, projectPath, subEntries })])
  await hoistRootDevDeps({ issues, projectPath, rootPkgPath, subEntries })
  return issues
}
const syncUiWorkspace = async (projectPath: string, issues: Issue[]): Promise<void> => {
  const pkgPath = join(projectPath, 'package.json')
  const pkgFile = file(pkgPath)
  if (!(await pkgFile.exists())) return
  const pkg = parseJson<Record<string, unknown>>(await pkgFile.text())
  const { workspaces } = pkg
  if (!Array.isArray(workspaces) || workspaces.some(w => w === READONLY_UI || w === 'readonly/*' || w === 'readonly/**'))
    return
  workspaces.push(READONLY_UI)
  await write(pkgPath, `${JSON.stringify(pkg, undefined, 2)}\n`)
  issues.push({ detail: `added ${READONLY_UI} to workspaces`, type: 'synced' })
}
const syncUi = async (cnsyncPath: string, projectPath: string): Promise<Issue[]> => {
  const src = join(cnsyncPath, READONLY_UI)
  const dst = join(projectPath, READONLY_UI)
  if (!(await doesPathExist(src))) return [{ detail: `${READONLY_UI} not found in cnsync repo`, type: 'error' }]
  if (projectPath === cnsyncPath) return []
  await cp(src, dst, { recursive: true })
  await Promise.all(
    ['mjs', 'ts', 'js'].map(async ext => {
      const p = join(dst, `postcss.config.${ext}`)
      if (await doesPathExist(p)) await rm(p)
    })
  )
  const issues: Issue[] = []
  await syncUiWorkspace(projectPath, issues)
  issues.push({ detail: `${READONLY_UI} updated`, type: 'synced' })
  return issues
}
const NEXT_BUILD_RE = /(?<!bunx --bun )\bnext build\b/gu
const FUMADOCS_MDX_RE = /(?<!bunx --bun )\bfumadocs-mdx\b/gu
const BUILD_ID_GATE = 'test -f .next/BUILD_ID'
const gateNextBuild = (script: string): string =>
  script.includes(BUILD_ID_GATE)
    ? script
    : script.replace('bunx --bun next build', `(bunx --bun next build || ${BUILD_ID_GATE})`)
const patchFumadocsScript = (script: string): string =>
  gateNextBuild(
    script.replaceAll(NEXT_BUILD_RE, 'bunx --bun next build').replaceAll(FUMADOCS_MDX_RE, 'bunx --bun fumadocs-mdx')
  )
const syncFumadocsBuild = async (projectPath: string): Promise<Issue[]> => {
  const entries = await collectWorkspacePackages(projectPath)
  const fumadocsApps = entries.filter(e => {
    const allDeps = { ...e.pkg.dependencies, ...e.pkg.devDependencies }
    return Boolean(allDeps['fumadocs-ui'])
  })
  const results = await Promise.all(
    fumadocsApps.map(async app => {
      const scripts = app.pkg.scripts ?? {}
      const next = Object.fromEntries(
        Object.entries(scripts).map(([k, v]): [string, string] => [k, patchFumadocsScript(v)])
      )
      if (Object.entries(next).every(([k, v]) => v === scripts[k])) return
      await write(app.path, `${JSON.stringify({ ...app.pkg, scripts: next }, undefined, 2)}\n`)
      const rel = app.path.replace(`${projectPath}/`, '')
      return { detail: `${rel} prefixed fumadocs/next build with bunx --bun`, type: 'synced' } satisfies Issue
    })
  )
  return results.filter((r): r is Issue => r !== undefined)
}
const getProjectGithubUrl = async (projectPath: string): Promise<string | undefined> => {
  const r = await $`gh repo view --json url -q .url`.cwd(projectPath).quiet().nothrow()
  if (r.exitCode !== 0) return
  const url = r.stdout.toString().trim()
  return url || undefined
}
const ALIAS_TRIM_RE = /\/\*$/u
const ALIAS_DOT_SLASH_RE = /^\.\//u
const resolveLibBase = async (appDir: string): Promise<string> => {
  const tsconfig = await readJson(join(appDir, 'tsconfig.json'))
  /** biome-ignore lint/nursery/noUnsafeTypeAssertion: compilerOptions is read from validated tsconfig JSON */
  const paths = (tsconfig?.compilerOptions as TsconfigCompilerOptions | undefined)?.paths
  const aliasTarget = paths?.['@/*']?.[0]
  if (!aliasTarget) return 'src'
  return aliasTarget.replace(ALIAS_TRIM_RE, '').replace(ALIAS_DOT_SLASH_RE, '') || '.'
}
const layoutSharedRel = (libBase: string): string =>
  libBase === '.' ? 'lib/layout.shared.tsx' : `${libBase}/lib/layout.shared.tsx`
const layoutSharedTemplate = (title: string, githubUrl: string): string =>
  `import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
export const baseOptions = (): BaseLayoutProps => ({
  githubUrl: '${githubUrl}',
  nav: {
    title: '${title}'
  }
})
`
const SCOPED_PREFIX_RE = /^@[^/]+\//u
const GITHUB_URL_KEY_RE = /\bgithubUrl\s*:/u
const BASEOPTIONS_OPEN_RE = /(?<open>\(\)[^=]*=>\s*\(\{\s*\n)/u
const stripScopedPrefix = (name: string): string => name.replace(SCOPED_PREFIX_RE, '')
interface PatchArgs {
  githubUrl: string
  projectPath: string
  sharedPath: string
  title: string
}
const createSharedFile = async ({ githubUrl, sharedPath, title }: PatchArgs, relShared: string): Promise<Issue> => {
  await mkdir(dirname(sharedPath), { recursive: true })
  await write(sharedPath, layoutSharedTemplate(title, githubUrl))
  return { detail: `${relShared} created with baseOptions + githubUrl`, type: 'synced' }
}
const patchSharedFile = async (args: PatchArgs): Promise<Issue | undefined> => {
  const { githubUrl, projectPath, sharedPath } = args
  const relShared = sharedPath.replace(`${projectPath}/`, '')
  const sharedFile = file(sharedPath)
  if (!(await sharedFile.exists())) return createSharedFile(args, relShared)
  const content = await sharedFile.text()
  if (GITHUB_URL_KEY_RE.test(content)) return
  const next = content.replace(BASEOPTIONS_OPEN_RE, `$<open>  githubUrl: '${githubUrl}',\n`)
  if (next === content) return
  await write(sharedPath, next)
  return { detail: `${relShared} added githubUrl`, type: 'synced' }
}
const syncFumadocsGithubUrl = async (projectPath: string): Promise<Issue[]> => {
  const entries = await collectWorkspacePackages(projectPath)
  const fumadocsApps = entries.filter(e => {
    const allDeps = { ...e.pkg.dependencies, ...e.pkg.devDependencies }
    return Boolean(allDeps['fumadocs-ui'])
  })
  if (fumadocsApps.length === 0) return []
  const githubUrl = await getProjectGithubUrl(projectPath)
  if (!githubUrl) return []
  const results = await Promise.all(
    fumadocsApps.map(async app => {
      const appDir = dirname(app.path)
      const libBase = await resolveLibBase(appDir)
      return patchSharedFile({
        githubUrl,
        projectPath,
        sharedPath: join(appDir, layoutSharedRel(libBase)),
        title: stripScopedPrefix(app.pkg.name ?? 'docs')
      })
    })
  )
  return results.filter((r): r is Issue => r !== undefined)
}
export {
  canonicalizeClaudeMd,
  checkClaudeMdFresh,
  patchFumadocsScript,
  didRemoveStalePublishScripts as removeStalePublishScripts,
  serializeTsdownConfig,
  syncClaudeMd,
  syncConfigs,
  syncFumadocsBuild,
  syncFumadocsGithubUrl,
  syncPackageJson,
  syncSubPackages,
  syncTsconfig,
  syncUi
}
