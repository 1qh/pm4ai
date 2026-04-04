import { $ } from 'bun'
import { join } from 'node:path'
import type { Issue, PackageJson } from './types.js'
import { FORBIDDEN_PM_PREFIXES, SKIP_PATTERNS, TURBO_FLAG } from './constants.js'
import { collectWorkspacePackages } from './utils.js'
interface PkgEntry {
  path: string
  pkg: PackageJson
}
const latestNpmVersionCache = new Map<string, Promise<string | undefined>>()
const fetchNpmVersion = async (pkg: string): Promise<string | undefined> => {
  const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`).catch(() => undefined)
  if (!res?.ok) return
  const data = (await res.json()) as { version: string }
  return data.version
}
const getLatestNpmVersion = async (pkg: string): Promise<string | undefined> => {
  const cached = latestNpmVersionCache.get(pkg)
  if (cached) {
    const v = await cached
    return v
  }
  const p = fetchNpmVersion(pkg)
  latestNpmVersionCache.set(pkg, p)
  const v = await p
  return v
}
let latestBunVersionCache: Promise<string | undefined> | undefined
const fetchBunVersion = async (): Promise<string | undefined> => {
  const res = await fetch('https://api.github.com/repos/oven-sh/bun/releases/latest').catch(() => undefined)
  if (!res?.ok) return
  const data = (await res.json()) as { tag_name: string }
  return data.tag_name.replace('bun-v', '')
}
const getLatestBunVersion = async (): Promise<string | undefined> => {
  if (latestBunVersionCache) {
    const v = await latestBunVersionCache
    return v
  }
  latestBunVersionCache = fetchBunVersion()
  const v = await latestBunVersionCache
  return v
}
const isAutoSynced = (pkgPath: string) => SKIP_PATTERNS.some(p => pkgPath.includes(p))
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
    const isPublished = !pkg.private && (pkg.exports ?? pkg.main ?? pkg.bin)
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
    const duplicated = [...ownDeps].filter(d => providedByWs.has(d))
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
  issues.push(...checkPackageConventions(pkgs, projectPath))
  issues.push(...checkNotLatest(pkgs, projectPath))
  issues.push(...checkDuplicates(pkgs, projectPath))
  issues.push(...checkScripts(pkgs, projectPath))
  return issues
}
export { audit, usesForbidden }
