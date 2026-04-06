import { $ } from 'bun'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Issue, PackageJson } from './types.js'
import {
  FORBIDDEN_PM_PREFIXES,
  REQUIRED_ROOT_DEVDEPS,
  REQUIRED_TRUSTED_DEPS,
  SKIP_PATTERNS,
  TURBO_FLAG
} from './constants.js'
import { collectWorkspacePackages, debug } from './utils.js'
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
  const data = (await res.json()) as { version: string }
  return data.version
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
  const data = (await res.json()) as { tag_name: string }
  return data.tag_name.replace('bun-v', '')
}
const getLatestBunVersion = async (): Promise<string | undefined> => {
  if (latestBunVersionCache) return latestBunVersionCache
  latestBunVersionCache = fetchBunVersion()
  const v = await latestBunVersionCache
  if (!v) latestBunVersionCache = undefined
  return v
}
const isAutoSynced = (pkgPath: string) => SKIP_PATTERNS.some(p => pkgPath.includes(p))
const isPublishedPkg = (pkg: PackageJson): boolean =>
  !pkg.private && Boolean(pkg.name) && Boolean(pkg.exports ?? pkg.main ?? pkg.bin)
const getDepsFromPkg = (pkg: PackageJson): Map<string, string> => {
  const result = new Map<string, string>()
  for (const field of ['dependencies', 'devDependencies'] as const) {
    const deps = pkg[field]
    if (deps) for (const [n, v] of Object.entries(deps)) result.set(n, v)
  }
  return result
}
const checkPackageConventions = (pkgs: PkgEntry[], projectPath: string): Issue[] => {
  const issues: Issue[] = []
  const filtered = pkgs.filter(p => !isAutoSynced(p.path) && p.path !== join(projectPath, 'package.json'))
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
const checkNotLatest = (pkgs: PkgEntry[], projectPath: string): Issue[] => {
  const issues: Issue[] = []
  const filtered = pkgs.filter(p => !isAutoSynced(p.path))
  for (const { path: pkgPath, pkg } of filtered) {
    const shortPath = pkgPath.replace(`${projectPath}/`, '')
    for (const [name, version] of getDepsFromPkg(pkg))
      if (version !== 'latest' && !version.startsWith('workspace:') && !version.startsWith('^'))
        issues.push({ detail: `${name} should be "latest" or "^major" (got ${version}) in ${shortPath}`, type: 'dep' })
  }
  return issues
}
const checkDuplicates = (pkgs: PkgEntry[], projectPath: string): Issue[] => {
  const issues: Issue[] = []
  const pkgDepsByName = new Map<string, Set<string>>()
  for (const { pkg } of pkgs.filter(p => p.pkg.name)) {
    const prodDeps = pkg.dependencies
    const deps = new Set(
      Object.entries(prodDeps ?? {})
        .filter(([n, v]) => !(v.startsWith('workspace:') || n.startsWith('@types/')))
        .map(([n]) => n)
    )
    const { name } = pkg
    if (name) pkgDepsByName.set(name, deps)
  }
  const filtered = pkgs.filter(p => !isAutoSynced(p.path))
  for (const { path: pkgPath, pkg } of filtered) {
    const shortPath = pkgPath.replace(`${projectPath}/`, '')
    const allDeps = [...getDepsFromPkg(pkg)]
    const wsDeps = allDeps.filter(([, v]) => v.startsWith('workspace:')).map(([n]) => n)
    const ownDeps = new Set(allDeps.filter(([, v]) => !v.startsWith('workspace:')).map(([n]) => n))
    const providedByWs = new Set<string>()
    for (const ws of wsDeps) for (const d of pkgDepsByName.get(ws) ?? []) providedByWs.add(d)
    const isRoot = pkgPath === join(projectPath, 'package.json')
    const duplicated = [...ownDeps].filter(d => providedByWs.has(d) && !(isRoot && REQUIRED_ROOT_DEVDEPS.includes(d)))
    for (const dep of duplicated)
      issues.push({ detail: `${dep} in ${shortPath} already provided by workspace dep`, type: 'duplicate' })
  }
  return issues
}
const usesForbidden = (cmd: string) =>
  FORBIDDEN_PM_PREFIXES.some(p => cmd.startsWith(p) || cmd.includes(` && ${p}`) || cmd.includes(` || ${p}`))
const turboRe = /\bturbo\b/u
const checkScripts = (pkgs: PkgEntry[], projectPath: string): Issue[] => {
  const issues: Issue[] = []
  const rootPkgPath = join(projectPath, 'package.json')
  const filtered = pkgs.filter(p => !isAutoSynced(p.path))
  for (const { path: pkgPath, pkg } of filtered) {
    const shortPath = pkgPath.replace(`${projectPath}/`, '')
    const isRoot = pkgPath === rootPkgPath
    const scripts = Object.entries(pkg.scripts ?? {})
    for (const [script, cmd] of scripts) {
      if (usesForbidden(cmd)) issues.push({ detail: `"${script}" uses non-bun pm in ${shortPath}`, type: 'forbidden' })
      if (isRoot && turboRe.test(cmd) && !cmd.includes(TURBO_FLAG) && !script.startsWith('dev'))
        issues.push({ detail: `"${script}" missing ${TURBO_FLAG}`, type: 'drift' })
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
  if (scripts.check && !scripts.check.includes('lintmax') && !scripts.check.includes('cli.js check'))
    issues.push({ detail: 'root "check" should include "lintmax check"', type: 'drift' })
  if (scripts.fix && !scripts.fix.includes('lintmax') && !scripts.fix.includes('cli.js fix'))
    issues.push({ detail: 'root "fix" should include "lintmax fix"', type: 'drift' })
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
const checkTrustedDeps = (rootPkg: PackageJson): Issue[] => {
  const issues: Issue[] = []
  const trusted = rootPkg.trustedDependencies ?? []
  for (const dep of REQUIRED_TRUSTED_DEPS)
    if (!trusted.includes(dep)) issues.push({ detail: `root missing "${dep}" in trustedDependencies`, type: 'missing' })
  return issues
}
const checkPublishedPkgConventions = (pkgs: PkgEntry[], projectPath: string): Issue[] => {
  const issues: Issue[] = []
  const published = pkgs.filter(p => isPublishedPkg(p.pkg))
  for (const { path: pkgPath, pkg } of published) {
    const shortPath = pkgPath.replace(`${projectPath}/`, '')
    if (!pkg.scripts?.postpublish)
      issues.push({ detail: `${shortPath} published but missing "postpublish" cleanup`, type: 'drift' })
    const scriptFile = join(dirname(pkgPath), 'script', 'cleanup-old-versions.ts')
    if (pkg.scripts?.postpublish && !existsSync(scriptFile))
      issues.push({ detail: `${shortPath} has postpublish but missing script/cleanup-old-versions.ts`, type: 'missing' })
  }
  return issues
}
const checkAppPackages = (pkgs: PkgEntry[], projectPath: string): Issue[] => {
  const issues: Issue[] = []
  for (const { path: pkgPath, pkg } of pkgs) {
    const rel = pkgPath.replace(`${projectPath}/`, '')
    if (rel.startsWith('apps/') && !pkg.private) issues.push({ detail: `${rel} should be private`, type: 'drift' })
  }
  return issues
}
const gitCleanRe = /\bgit\s+clean\b/u
const checkSubPkgScripts = (pkgs: PkgEntry[], projectPath: string): Issue[] => {
  const issues: Issue[] = []
  const rootPkgPath = join(projectPath, 'package.json')
  const filtered = pkgs.filter(p => !isAutoSynced(p.path) && p.path !== rootPkgPath)
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
  const rootDeps = getDepsFromPkg(rootPkg ?? {})
  const lintmaxVersion = rootDeps.get('lintmax')
  if (lintmaxVersion && !lintmaxVersion.startsWith('workspace:')) {
    const lintmaxLatest = await getLatestNpmVersion('lintmax')
    if (lintmaxLatest) {
      const result = await $`bun why lintmax`.cwd(projectPath).quiet().nothrow()
      const resolved = result.stdout.toString().trim()
      if (resolved && !resolved.includes(lintmaxLatest))
        issues.push({ detail: `resolved version behind latest ${lintmaxLatest}`, type: 'lintmax' })
    }
  }
  if (rootPkg) {
    issues.push(...checkRootScripts(rootPkg))
    issues.push(...checkRootWorkspacesAndDevDeps(rootPkg))
    issues.push(...checkTrustedDeps(rootPkg))
  }
  issues.push(...checkPackageConventions(pkgs, projectPath))
  issues.push(...checkNotLatest(pkgs, projectPath))
  issues.push(...checkDuplicates(pkgs, projectPath))
  issues.push(...checkScripts(pkgs, projectPath))
  issues.push(...checkPublishedPkgConventions(pkgs, projectPath))
  issues.push(...checkAppPackages(pkgs, projectPath))
  issues.push(...checkSubPkgScripts(pkgs, projectPath))
  const publishedPkgs = pkgs.filter(p => isPublishedPkg(p.pkg))
  await Promise.all(
    publishedPkgs.map(async p => {
      const r = await $`bun pm view ${p.pkg.name} versions --json`.quiet().nothrow()
      if (r.exitCode !== 0) return
      try {
        const parsed: unknown = JSON.parse(r.stdout.toString())
        if (Array.isArray(parsed) && parsed.length > 1)
          issues.push({ detail: `${p.pkg.name} has ${parsed.length} versions published, run cleanup`, type: 'drift' })
      } catch {
        /* Noop */
      }
    })
  )
  return issues
}
export {
  audit,
  checkAppPackages,
  checkDuplicates,
  checkNotLatest,
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
