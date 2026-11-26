import { $, file } from 'bun'
import { dirname, join } from 'node:path'
import type { Issue, PackageJson } from './types.js'
import {
  FORBIDDEN_PM_PREFIXES,
  LINTMAX_PKG,
  PRUNE_POSTPUBLISH,
  REQUIRED_ROOT_DEVDEPS,
  TURBO_FLAG,
  TURBO_WARNING_FILTER
} from './constants.js'
import { parseJson } from './json.js'
import { ghReleaseSchema, npmVersionSchema, safeParse } from './schemas.js'
import { DEP_FIELDS } from './types.js'
import {
  buildPkgDepMap,
  collectWorkspacePackages,
  debug,
  gitCleanRe,
  isSkippedPath,
  providedByWorkspaces,
  retiredManagedFiles
} from './utils.js'
interface PkgEntry {
  path: string
  pkg: PackageJson
}
const cachedVersion = async (
  cache: Map<string, Promise<string | undefined>>,
  key: string,
  fetcher: () => Promise<string | undefined>
): Promise<string | undefined> => {
  const cached = cache.get(key)
  if (cached) return cached
  const p = fetcher()
  cache.set(key, p)
  const v = await p
  if (!v) cache.delete(key)
  return v
}
const latestNpmVersionCache = new Map<string, Promise<string | undefined>>()
const fetchNpmVersion = async (pkg: string): Promise<string | undefined> => {
  const url = `https://registry.npmjs.org/${pkg}/latest`
  const res = await fetch(url).catch(() => undefined)
  if (!res?.ok) {
    debug('fetch failed:', url)
    return
  }
  const data = safeParse(npmVersionSchema, await res.json())
  return data?.version
}
const getLatestNpmVersion = async (pkg: string): Promise<string | undefined> =>
  cachedVersion(latestNpmVersionCache, pkg, async () => fetchNpmVersion(pkg))
const latestBunVersionCache = new Map<string, Promise<string | undefined>>()
const fetchBunVersion = async (): Promise<string | undefined> => {
  const url = 'https://api.github.com/repos/oven-sh/bun/releases/latest'
  const res = await fetch(url).catch(() => undefined)
  if (!res?.ok) {
    debug('fetch failed:', url)
    return
  }
  const data = safeParse(ghReleaseSchema, await res.json())
  return data?.tag_name.replace('bun-v', '')
}
const getLatestBunVersion = async (): Promise<string | undefined> =>
  cachedVersion(latestBunVersionCache, 'bun', fetchBunVersion)
const isPublishedPkg = (pkg: PackageJson): boolean =>
  !pkg.private && Boolean(pkg.name) && Boolean(pkg.exports ?? pkg.main ?? pkg.bin)
const getDepsFromPkg = (pkg: PackageJson): Map<string, string> => {
  const result = new Map<string, string>()
  for (const field of DEP_FIELDS) {
    const deps = pkg[field]
    if (deps) for (const [n, v] of Object.entries(deps)) result.set(n, v)
  }
  return result
}
const drift = (checks: [boolean, string][]): Issue[] =>
  checks.filter(([isFailing]) => isFailing).map(([, detail]) => ({ detail, type: 'drift' }))
const packageConventionIssues = (pkg: PackageJson, shortPath: string): Issue[] => {
  const externalDevDeps = Object.entries(pkg.devDependencies ?? {}).filter(([, v]) => !v.startsWith('workspace:'))
  const publishedChecks: [boolean, string][] = isPublishedPkg(pkg)
    ? [
        [pkg.type !== 'module', `${shortPath} should have "type": "module"`],
        [!pkg.files, `${shortPath} missing "files" field`],
        [!pkg.license, `${shortPath} missing "license" field`],
        [!pkg.repository, `${shortPath} missing "repository" field`]
      ]
    : []
  return drift([
    ...publishedChecks,
    [externalDevDeps.length > 0, `${shortPath} devDependencies should be hoisted to root`]
  ])
}
const checkPackageConventions = (pkgs: PkgEntry[], projectPath: string): Issue[] =>
  pkgs
    .filter(p => !isSkippedPath(p.path) && p.path !== join(projectPath, 'package.json'))
    .flatMap(({ path: pkgPath, pkg }) => packageConventionIssues(pkg, pkgPath.replace(`${projectPath}/`, '')))
const duplicateIssues = (
  { path: pkgPath, pkg }: PkgEntry,
  projectPath: string,
  pkgDepsByName: Map<string, Set<string>>
): Issue[] => {
  const shortPath = pkgPath.replace(`${projectPath}/`, '')
  const allDeps = [...getDepsFromPkg(pkg)]
  const wsDeps = allDeps.filter(([, v]) => v.startsWith('workspace:')).map(([n]) => n)
  const ownDeps = new Set(allDeps.filter(([, v]) => !v.startsWith('workspace:')).map(([n]) => n))
  const providedByWs = providedByWorkspaces(wsDeps, pkgDepsByName)
  const isRoot = pkgPath === join(projectPath, 'package.json')
  const isApp = shortPath.startsWith('apps/')
  return [...ownDeps]
    .filter(d => providedByWs.has(d) && !(isRoot && REQUIRED_ROOT_DEVDEPS.includes(d)) && !isApp)
    .map(dep => ({ detail: `${dep} in ${shortPath} already provided by workspace dep`, type: 'duplicate' }))
}
const checkDuplicates = (pkgs: PkgEntry[], projectPath: string): Issue[] => {
  const pkgDepsByName = buildPkgDepMap(pkgs)
  return pkgs.filter(p => !isSkippedPath(p.path)).flatMap(entry => duplicateIssues(entry, projectPath, pkgDepsByName))
}
const isForbiddenUsed = (cmd: string) =>
  FORBIDDEN_PM_PREFIXES.some(p => cmd.startsWith(p) || cmd.includes(` && ${p}`) || cmd.includes(` || ${p}`))
const isLintmaxScript = (script: string | undefined, command: 'check' | 'fix'): boolean => {
  const value = script ?? ''
  return (
    value.endsWith(`${LINTMAX_PKG} ${command}`) ||
    value.endsWith(`cli.js ${command}`) ||
    value.endsWith(`cli.mjs ${command}`)
  )
}
const turboRe = /\bturbo\b/u
interface ScriptIssuesArgs {
  cmd: string
  isRoot: boolean
  script: string
  shortPath: string
}
const scriptIssues = ({ cmd, isRoot, script, shortPath }: ScriptIssuesArgs): Issue[] => {
  const isRootTurbo = isRoot && turboRe.test(cmd) && !script.startsWith('dev')
  return [
    ...(isForbiddenUsed(cmd)
      ? [{ detail: `"${script}" uses non-bun pm in ${shortPath}`, type: 'forbidden' as const }]
      : []),
    ...drift([
      [isRootTurbo && !cmd.includes(TURBO_FLAG), `"${script}" missing ${TURBO_FLAG}`],
      [
        isRootTurbo && cmd.includes(TURBO_FLAG) && !cmd.includes(TURBO_WARNING_FILTER),
        `"${script}" missing turbo workspace warning filter`
      ]
    ])
  ]
}
const pkgScriptIssues = ({ path: pkgPath, pkg }: PkgEntry, projectPath: string): Issue[] => {
  const shortPath = pkgPath.replace(`${projectPath}/`, '')
  const isRoot = pkgPath === join(projectPath, 'package.json')
  const scripts = Object.entries(pkg.scripts ?? {})
  return [
    ...scripts.flatMap(([script, cmd]) => scriptIssues({ cmd, isRoot, script, shortPath })),
    ...drift([
      [!isRoot && scripts.some(([s]) => s === 'clean'), `${shortPath} has redundant "clean" script, use root clean.sh`]
    ])
  ]
}
const checkScripts = (pkgs: PkgEntry[], projectPath: string): Issue[] =>
  pkgs.filter(p => !isSkippedPath(p.path)).flatMap(entry => pkgScriptIssues(entry, projectPath))
const checkRootScripts = (rootPkg: PackageJson): Issue[] => {
  const issues: Issue[] = []
  const scripts = rootPkg.scripts ?? {}
  if (!scripts.build?.includes('turbo')) issues.push({ detail: 'root "build" should use turbo', type: 'drift' })
  if (scripts.check && !isLintmaxScript(scripts.check, 'check'))
    issues.push({ detail: 'root "check" should include "lintmax check"', type: 'drift' })
  if (scripts.fix && !isLintmaxScript(scripts.fix, 'fix'))
    issues.push({ detail: 'root "fix" should end with "lintmax fix"', type: 'drift' })
  return issues
}
/** The spec must be exactly "latest": lintmax keeps a single present release, so a range stops resolving the moment its pinned version is pruned, and a fresh install then fails where the developer's own node_modules still holds the old copy. An empty `bun why` is that failure, so it is reported rather than skipped. */
const checkLintmaxSpec = async (spec: string | undefined, projectPath: string): Promise<Issue[]> => {
  if (spec === undefined || spec.startsWith('workspace:')) return []
  const issues: Issue[] = []
  if (spec !== 'latest') issues.push({ detail: `spec "${spec}" is a range, must be "latest"`, type: LINTMAX_PKG })
  const latest = await getLatestNpmVersion(LINTMAX_PKG)
  if (!latest) return issues
  const result = await $`bun why ${LINTMAX_PKG}`.cwd(projectPath).quiet().nothrow()
  const resolved = result.stdout.toString().trim()
  if (resolved.length === 0) issues.push({ detail: `spec "${spec}" resolves to nothing installed`, type: LINTMAX_PKG })
  else if (!resolved.includes(latest))
    issues.push({ detail: `resolved version behind latest ${latest}`, type: LINTMAX_PKG })
  return issues
}
const checkRootWorkspacesAndDevDeps = (rootPkg: PackageJson): Issue[] => {
  const issues: Issue[] = []
  if (!rootPkg.workspaces || rootPkg.workspaces.length === 0)
    issues.push({ detail: 'root missing "workspaces" field', type: 'missing' })
  const allDeps = { ...rootPkg.dependencies, ...rootPkg.devDependencies }
  const missingDevDeps = REQUIRED_ROOT_DEVDEPS.filter(dep => !allDeps[dep])
  issues.push(
    ...missingDevDeps.map(dep => ({ detail: `root missing "${dep}" in devDependencies`, type: 'missing' as const }))
  )
  return issues
}
const checkTrustedDeps = (rootPkg: PackageJson, requiredTrusted?: string[]): Issue[] => {
  const trusted = rootPkg.trustedDependencies ?? []
  return (requiredTrusted ?? [])
    .filter(dep => !trusted.includes(dep))
    .map(dep => ({ detail: `root missing "${dep}" in trustedDependencies`, type: 'missing' }))
}
const checkPublishedPkgConventions = async (pkgs: PkgEntry[], projectPath: string): Promise<Issue[]> => {
  const published = pkgs.filter(p => isPublishedPkg(p.pkg))
  const nested = await Promise.all(
    published.map(async ({ path: pkgPath, pkg }) => {
      const issues: Issue[] = []
      const shortPath = pkgPath.replace(`${projectPath}/`, '')
      if (pkg.scripts?.postpublish === PRUNE_POSTPUBLISH)
        issues.push({ detail: `${shortPath} has retired postpublish prune hook — run pm4ai fix`, type: 'drift' })
      if (pkg.scripts?.build && pkg.scripts.build !== 'tsdown')
        issues.push({ detail: `${shortPath} build must be exactly "tsdown"`, type: 'drift' })
      if (pkg.scripts?.build && pkg.scripts.prepublishOnly !== 'bun run build')
        issues.push({
          detail: `${shortPath} missing "prepublishOnly": "bun run build" — stale dist will ship`,
          type: 'drift'
        })
      const hasTsdown = await file(join(dirname(pkgPath), 'tsdown.config.ts')).exists()
      if (!hasTsdown) issues.push({ detail: `${shortPath} missing tsdown.config.ts`, type: 'missing' })
      return issues
    })
  )
  return nested.flat()
}
const checkAppPackages = (pkgs: PkgEntry[], projectPath: string): Issue[] => {
  const issues: Issue[] = []
  for (const { path: pkgPath, pkg } of pkgs) {
    const rel = pkgPath.replace(`${projectPath}/`, '')
    if (rel.startsWith('apps/') && !pkg.private) issues.push({ detail: `${rel} should be private`, type: 'drift' })
  }
  return issues
}
const subPkgScriptIssues = ({ path: pkgPath, pkg }: PkgEntry, projectPath: string): Issue[] => {
  const shortPath = pkgPath.replace(`${projectPath}/`, '')
  return Object.entries(pkg.scripts ?? {})
    .filter(([, cmd]) => gitCleanRe.test(cmd))
    .map(([script]) => ({ detail: `"${script}" uses git clean in ${shortPath}, use rm -rf`, type: 'forbidden' }))
}
const checkSubPkgScripts = (pkgs: PkgEntry[], projectPath: string): Issue[] => {
  const rootPkgPath = join(projectPath, 'package.json')
  return pkgs
    .filter(p => !isSkippedPath(p.path) && p.path !== rootPkgPath)
    .flatMap(entry => subPkgScriptIssues(entry, projectPath))
}
const UNPUBLISH_WINDOW_MS = 72 * 60 * 60 * 1000
interface RegistryDoc {
  time?: Record<string, string>
  versions?: Record<string, { deprecated?: string }>
}
const fetchRegistryDoc = async (name: string | undefined): Promise<RegistryDoc | undefined> => {
  const res = await fetch(`https://registry.npmjs.org/${name}`).catch(() => undefined)
  if (!res?.ok) return
  try {
    return parseJson<RegistryDoc>(await res.text())
  } catch {
    debug('unparseable registry document:', name)
  }
}
const checkPublishedVersions = async (name: string | undefined): Promise<Issue[]> => {
  const doc = await fetchRegistryDoc(name)
  if (!doc) return []
  const manifests = doc.versions ?? {}
  const versions = Object.keys(manifests).filter(v => manifests[v]?.deprecated === undefined)
  if (versions.length <= 1) return []
  const times = doc.time ?? {}
  const now = Date.now()
  const stale = versions
    .slice(0, -1)
    .filter(v => typeof times[v] === 'string' && now - Date.parse(times[v]) > UNPUBLISH_WINDOW_MS)
  const detail =
    stale.length === 0
      ? `${name} has ${versions.length} versions published, run cleanup`
      : `${name} has ${versions.length} versions, ${stale.length} unpublishable (>72h) — npm blocks unpublish, deprecate instead`
  return [{ detail, type: 'drift' }]
}
const checkBunVersion = async (rootPkg: PackageJson | undefined): Promise<Issue[]> => {
  const bunVersion = rootPkg?.packageManager?.replace('bun@', '')
  if (!bunVersion) return []
  const latest = await getLatestBunVersion()
  return latest && bunVersion !== latest ? [{ detail: `${bunVersion} behind latest ${latest}`, type: 'bun' }] : []
}
const checkRootPackage = async (rootPkg: PackageJson | undefined): Promise<Issue[]> => {
  if (!rootPkg) return []
  const selfPkgFile = file(join(import.meta.dirname, '..', '..', '..', 'package.json'))
  const selfPkgExists = await selfPkgFile.exists()
  const selfPkg = selfPkgExists ? parseJson<PackageJson>(await selfPkgFile.text()) : {}
  return [
    ...checkRootScripts(rootPkg),
    ...checkRootWorkspacesAndDevDeps(rootPkg),
    ...checkTrustedDeps(rootPkg, selfPkg.trustedDependencies ?? [])
  ]
}
const audit = async (projectPath: string): Promise<Issue[]> => {
  const entries = await collectWorkspacePackages(projectPath)
  const pkgs: PkgEntry[] = entries.map(e => ({ path: e.path, pkg: e.pkg }))
  const rootPkg = pkgs[0]?.pkg
  const issues: Issue[] = [
    ...(await retiredManagedFiles(projectPath)).map(
      (name): Issue => ({ detail: `${name} present (retired managed file) — run pm4ai fix`, type: 'drift' })
    ),
    ...(await checkBunVersion(rootPkg)),
    ...(await checkLintmaxSpec(getDepsFromPkg(rootPkg ?? {}).get(LINTMAX_PKG), projectPath)),
    ...(await checkRootPackage(rootPkg)),
    ...checkPackageConventions(pkgs, projectPath),
    ...checkDuplicates(pkgs, projectPath),
    ...checkScripts(pkgs, projectPath),
    ...(await checkPublishedPkgConventions(pkgs, projectPath)),
    ...checkAppPackages(pkgs, projectPath),
    ...checkSubPkgScripts(pkgs, projectPath)
  ]
  const publishedPkgs = pkgs.filter(p => isPublishedPkg(p.pkg))
  const versionIssues = await Promise.all(publishedPkgs.map(async p => checkPublishedVersions(p.pkg.name)))
  return [...issues, ...versionIssues.flat()]
}
export {
  audit,
  checkAppPackages,
  checkDuplicates,
  checkLintmaxSpec,
  checkPackageConventions,
  checkPublishedPkgConventions,
  checkRootScripts,
  checkRootWorkspacesAndDevDeps,
  checkScripts,
  checkSubPkgScripts,
  checkTrustedDeps,
  isForbiddenUsed,
  isPublishedPkg,
  type PkgEntry
}
