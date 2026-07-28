import { $, file } from 'bun'
import { dirname, join } from 'node:path'
import type { Issue, PackageJson } from './types.js'
import {
  FORBIDDEN_PM_PREFIXES,
  LINTMAX_PKG,
  REQUIRED_ROOT_DEVDEPS,
  TURBO_FLAG,
  TURBO_WARNING_FILTER
} from './constants.js'
import { ghReleaseSchema, npmVersionSchema, safeParse } from './schemas.js'
import { DEP_FIELDS } from './types.js'
import { buildPkgDepMap, collectWorkspacePackages, debug, gitCleanRe, isSkippedPath } from './utils.js'

interface PkgEntry {
  path: string
  pkg: PackageJson
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
const getLatestNpmVersion = async (pkg: string): Promise<string | undefined> => {
  const cached = latestNpmVersionCache.get(pkg)
  if (cached) return cached
  const p = fetchNpmVersion(pkg)
  latestNpmVersionCache.set(pkg, p)
  const v = await p
  if (!v) latestNpmVersionCache.delete(pkg)
  return v
}
let latestBunVersionCache: Promise<string | undefined> | undefined
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
const getLatestBunVersion = async (): Promise<string | undefined> => {
  if (latestBunVersionCache) return latestBunVersionCache
  latestBunVersionCache = fetchBunVersion()
  const v = await latestBunVersionCache
  if (!v) latestBunVersionCache = undefined
  return v
}
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
// eslint-disable-next-line sonarjs/cognitive-complexity -- flat per-package convention checks; splitting hides the single audit surface
const checkPackageConventions = (pkgs: PkgEntry[], projectPath: string): Issue[] => {
  const issues: Issue[] = []
  const filtered = pkgs.filter(p => !isSkippedPath(p.path) && p.path !== join(projectPath, 'package.json'))
  for (const { path: pkgPath, pkg } of filtered) {
    const shortPath = pkgPath.replace(`${projectPath}/`, '')
    const isPublished = isPublishedPkg(pkg)
    if (isPublished) {
      if (pkg.type !== 'module') issues.push({ detail: `${shortPath} should have "type": "module"`, type: 'drift' })
      if (!pkg.files) issues.push({ detail: `${shortPath} missing "files" field`, type: 'drift' })
      if (!pkg.license) issues.push({ detail: `${shortPath} missing "license" field`, type: 'drift' })
      if (!pkg.repository) issues.push({ detail: `${shortPath} missing "repository" field`, type: 'drift' })
    }
    const devDeps = pkg.devDependencies
    const externalDevDeps = devDeps ? Object.entries(devDeps).filter(([, v]) => !v.startsWith('workspace:')) : []
    if (externalDevDeps.length > 0)
      issues.push({ detail: `${shortPath} devDependencies should be hoisted to root`, type: 'drift' })
  }
  return issues
}
const checkDuplicates = (pkgs: PkgEntry[], projectPath: string): Issue[] => {
  const issues: Issue[] = []
  const pkgDepsByName = buildPkgDepMap(pkgs)
  const filtered = pkgs.filter(p => !isSkippedPath(p.path))
  for (const { path: pkgPath, pkg } of filtered) {
    const shortPath = pkgPath.replace(`${projectPath}/`, '')
    const allDeps = [...getDepsFromPkg(pkg)]
    const wsDeps = allDeps.filter(([, v]) => v.startsWith('workspace:')).map(([n]) => n)
    const ownDeps = new Set(allDeps.filter(([, v]) => !v.startsWith('workspace:')).map(([n]) => n))
    const providedByWs = new Set<string>()
    for (const ws of wsDeps) for (const d of pkgDepsByName.get(ws) ?? []) providedByWs.add(d)
    const isRoot = pkgPath === join(projectPath, 'package.json')
    const isApp = shortPath.startsWith('apps/')
    const duplicated = [...ownDeps].filter(
      d => providedByWs.has(d) && !(isRoot && REQUIRED_ROOT_DEVDEPS.includes(d)) && !isApp
    )
    for (const dep of duplicated)
      issues.push({ detail: `${dep} in ${shortPath} already provided by workspace dep`, type: 'duplicate' })
  }
  return issues
}
const usesForbidden = (cmd: string) =>
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
// eslint-disable-next-line sonarjs/cognitive-complexity -- flat per-script convention checks over each package
const checkScripts = (pkgs: PkgEntry[], projectPath: string): Issue[] => {
  const issues: Issue[] = []
  const rootPkgPath = join(projectPath, 'package.json')
  const filtered = pkgs.filter(p => !isSkippedPath(p.path))
  for (const { path: pkgPath, pkg } of filtered) {
    const shortPath = pkgPath.replace(`${projectPath}/`, '')
    const isRoot = pkgPath === rootPkgPath
    const scripts = Object.entries(pkg.scripts ?? {})
    for (const [script, cmd] of scripts) {
      if (usesForbidden(cmd)) issues.push({ detail: `"${script}" uses non-bun pm in ${shortPath}`, type: 'forbidden' })
      if (isRoot && turboRe.test(cmd) && !cmd.includes(TURBO_FLAG) && !script.startsWith('dev'))
        issues.push({ detail: `"${script}" missing ${TURBO_FLAG}`, type: 'drift' })
      if (
        isRoot &&
        turboRe.test(cmd) &&
        cmd.includes(TURBO_FLAG) &&
        !script.startsWith('dev') &&
        !cmd.includes(TURBO_WARNING_FILTER)
      )
        issues.push({ detail: `"${script}" missing turbo workspace warning filter`, type: 'drift' })
    }
    if (!isRoot && scripts.some(([s]) => s === 'clean'))
      issues.push({ detail: `${shortPath} has redundant "clean" script, use root clean.sh`, type: 'drift' })
  }
  return issues
}
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
  for (const dep of REQUIRED_ROOT_DEVDEPS)
    if (!allDeps[dep]) issues.push({ detail: `root missing "${dep}" in devDependencies`, type: 'missing' })
  return issues
}
const checkTrustedDeps = (rootPkg: PackageJson, requiredTrusted?: string[]): Issue[] => {
  const issues: Issue[] = []
  const trusted = rootPkg.trustedDependencies ?? []
  for (const dep of requiredTrusted ?? [])
    if (!trusted.includes(dep)) issues.push({ detail: `root missing "${dep}" in trustedDependencies`, type: 'missing' })
  return issues
}
const checkPublishedPkgConventions = async (pkgs: PkgEntry[], projectPath: string): Promise<Issue[]> => {
  const published = pkgs.filter(p => isPublishedPkg(p.pkg))
  const nested = await Promise.all(
    published.map(async ({ path: pkgPath, pkg }) => {
      const issues: Issue[] = []
      const shortPath = pkgPath.replace(`${projectPath}/`, '')
      if (!pkg.scripts?.postpublish)
        issues.push({ detail: `${shortPath} published but missing "postpublish" cleanup`, type: 'drift' })
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
const checkSubPkgScripts = (pkgs: PkgEntry[], projectPath: string): Issue[] => {
  const issues: Issue[] = []
  const rootPkgPath = join(projectPath, 'package.json')
  const filtered = pkgs.filter(p => !isSkippedPath(p.path) && p.path !== rootPkgPath)
  for (const { path: pkgPath, pkg } of filtered) {
    const shortPath = pkgPath.replace(`${projectPath}/`, '')
    for (const [script, cmd] of Object.entries(pkg.scripts ?? {}))
      if (gitCleanRe.test(cmd))
        issues.push({ detail: `"${script}" uses git clean in ${shortPath}, use rm -rf`, type: 'forbidden' })
  }
  return issues
}
const audit = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const entries = await collectWorkspacePackages(projectPath)
  const pkgs: PkgEntry[] = entries.map(e => ({ path: e.path, pkg: e.pkg }))
  const rootPkg = pkgs[0]?.pkg
  const bunVersion = rootPkg?.packageManager?.replace('bun@', '')
  if (bunVersion) {
    const latest = await getLatestBunVersion()
    if (latest && bunVersion !== latest) issues.push({ detail: `${bunVersion} behind latest ${latest}`, type: 'bun' })
  }
  issues.push(...(await checkLintmaxSpec(getDepsFromPkg(rootPkg ?? {}).get(LINTMAX_PKG), projectPath)))
  if (rootPkg) {
    issues.push(...checkRootScripts(rootPkg), ...checkRootWorkspacesAndDevDeps(rootPkg))
    const selfPkgFile = file(join(import.meta.dirname, '..', '..', '..', 'package.json'))
    const selfPkgExists = await selfPkgFile.exists()
    const selfPkg = selfPkgExists ? ((await selfPkgFile.json()) as PackageJson) : ({} as PackageJson)
    issues.push(...checkTrustedDeps(rootPkg, selfPkg.trustedDependencies ?? []))
  }
  issues.push(
    ...checkPackageConventions(pkgs, projectPath),
    ...checkDuplicates(pkgs, projectPath),
    ...checkScripts(pkgs, projectPath),
    ...(await checkPublishedPkgConventions(pkgs, projectPath)),
    ...checkAppPackages(pkgs, projectPath),
    ...checkSubPkgScripts(pkgs, projectPath)
  )
  const publishedPkgs = pkgs.filter(p => isPublishedPkg(p.pkg))
  const UNPUBLISH_WINDOW_MS = 72 * 60 * 60 * 1000
  await Promise.all(
    publishedPkgs.map(async p => {
      const res = await fetch(`https://registry.npmjs.org/${p.pkg.name}`).catch(() => undefined)
      if (!res?.ok) return
      let doc: { time?: Record<string, string>; versions?: Record<string, { deprecated?: string }> }
      try {
        doc = (await res.json()) as typeof doc
      } catch {
        return
      }
      const manifests = doc.versions ?? {}
      const versions = Object.keys(manifests).filter(v => manifests[v]?.deprecated === undefined)
      if (versions.length <= 1) return
      const times = doc.time ?? {}
      const now = Date.now()
      const stale = versions
        .slice(0, -1)
        .filter(v => typeof times[v] === 'string' && now - Date.parse(times[v]) > UNPUBLISH_WINDOW_MS)
      const detail =
        stale.length === 0
          ? `${p.pkg.name} has ${versions.length} versions published, run cleanup`
          : `${p.pkg.name} has ${versions.length} versions, ${stale.length} unpublishable (>72h) — npm blocks unpublish, deprecate instead`
      issues.push({ detail, type: 'drift' })
    })
  )
  return issues
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
  isPublishedPkg,
  usesForbidden
}
export type { PkgEntry }
