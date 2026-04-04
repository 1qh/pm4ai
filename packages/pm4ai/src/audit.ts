import { $, file } from 'bun'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { FORBIDDEN_PM_PREFIXES, SKIP_PATTERNS, TURBO_FLAG } from './constants.js'
interface Issue {
  detail: string
  type: string
}
interface PkgEntry {
  path: string
  pkg: Record<string, unknown>
}
const getLatestNpmVersion = async (pkg: string): Promise<string | undefined> => {
  const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`)
  if (!res.ok) return
  const data = (await res.json()) as { version: string }
  return data.version
}
const getLatestBunVersion = async (): Promise<string | undefined> => {
  const res = await fetch('https://api.github.com/repos/oven-sh/bun/releases/latest')
  if (!res.ok) return
  const data = (await res.json()) as { tag_name: string }
  return data.tag_name.replace('bun-v', '')
}
const collectPkgJsons = async (projectPath: string): Promise<PkgEntry[]> => {
  const rootPkgPath = join(projectPath, 'package.json')
  const rootFile = file(rootPkgPath)
  if (!(await rootFile.exists())) return []
  const rootPkg = (await rootFile.json()) as Record<string, unknown>
  const results: PkgEntry[] = [{ path: rootPkgPath, pkg: rootPkg }]
  const workspaces = (rootPkg.workspaces as string[] | undefined) ?? []
  const wsPkgs = await Promise.all(
    workspaces.flatMap(ws => {
      const wsDir = join(projectPath, ws.replace('/*', ''))
      if (!existsSync(wsDir)) return []
      return readdirSync(wsDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(async e => {
          const pkgPath = join(wsDir, e.name, 'package.json')
          const pkgFile = file(pkgPath)
          if (!(await pkgFile.exists())) return
          return { path: pkgPath, pkg: (await pkgFile.json()) as Record<string, unknown> } as PkgEntry
        })
    })
  )
  for (const p of wsPkgs) if (p) results.push(p)
  return results
}
const isAutoSynced = (pkgPath: string) => SKIP_PATTERNS.some(p => pkgPath.includes(p))
const getDepsFromPkg = (pkg: Record<string, unknown>): Map<string, string> => {
  const result = new Map<string, string>()
  for (const field of ['dependencies', 'devDependencies']) {
    const deps = pkg[field] as Record<string, string> | undefined
    if (deps) for (const [n, v] of Object.entries(deps)) result.set(n, v)
  }
  return result
}
const checkPackageConventions = (pkgs: PkgEntry[], projectPath: string): Issue[] => {
  const issues: Issue[] = []
  for (const { path: pkgPath, pkg } of pkgs)
    if (isAutoSynced(pkgPath) || pkgPath === join(projectPath, 'package.json')) {
      // Skip root and auto-synced
    } else {
      const shortPath = pkgPath.replace(`${projectPath}/`, '')
      const isPublished = !pkg.private && (pkg.exports ?? pkg.main ?? pkg.bin)
      if (isPublished) {
        if (pkg.type !== 'module') issues.push({ detail: `${shortPath} should have "type": "module"`, type: 'drift' })
        if (!pkg.files) issues.push({ detail: `${shortPath} missing "files" field`, type: 'drift' })
        if (!pkg.license) issues.push({ detail: `${shortPath} missing "license" field`, type: 'drift' })
        if (!pkg.repository) issues.push({ detail: `${shortPath} missing "repository" field`, type: 'drift' })
      }
      const devDeps = pkg.devDependencies as Record<string, string> | undefined
      const externalDevDeps = devDeps ? Object.entries(devDeps).filter(([, v]) => !v.startsWith('workspace:')) : []
      if (externalDevDeps.length > 0)
        issues.push({ detail: `${shortPath} devDependencies should be hoisted to root`, type: 'drift' })
    }
  return issues
}
const checkNotLatest = (pkgs: PkgEntry[], projectPath: string): Issue[] => {
  const issues: Issue[] = []
  for (const { path: pkgPath, pkg } of pkgs)
    if (isAutoSynced(pkgPath)) {
      // Skip
    } else {
      const shortPath = pkgPath.replace(`${projectPath}/`, '')
      for (const [name, version] of getDepsFromPkg(pkg))
        if (version === 'latest' || version.startsWith('workspace:')) {
          // Ok
        } else if (version.startsWith('^')) {
          // Pinned major — acceptable
        } else
          issues.push({ detail: `${name} should be "latest" or "^major" (got ${version}) in ${shortPath}`, type: 'dep' })
    }
  return issues
}
const checkDuplicates = (pkgs: PkgEntry[], projectPath: string): Issue[] => {
  const issues: Issue[] = []
  const pkgDepsByName = new Map<string, Set<string>>()
  for (const { pkg } of pkgs) {
    const name = pkg.name as string | undefined
    if (name) {
      const deps = new Set<string>()
      for (const [n, v] of getDepsFromPkg(pkg)) if (!(v.startsWith('workspace:') || n.startsWith('@types/'))) deps.add(n)
      pkgDepsByName.set(name, deps)
    } else {
      // Skip
    }
  }
  for (const { path: pkgPath, pkg } of pkgs)
    if (isAutoSynced(pkgPath)) {
      // Skip
    } else {
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
  for (const { path: pkgPath, pkg } of pkgs)
    if (isAutoSynced(pkgPath)) {
      // Skip
    } else {
      const shortPath = pkgPath.replace(`${projectPath}/`, '')
      const isRoot = pkgPath === rootPkgPath
      const scripts = Object.entries((pkg.scripts ?? {}) as Record<string, string>)
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
  const pkgs = await collectPkgJsons(projectPath)
  const rootPkg = pkgs[0]?.pkg
  const bunVersion = (rootPkg?.packageManager as string | undefined)?.replace('bun@', '')
  if (bunVersion) {
    const latest = await getLatestBunVersion()
    if (latest && bunVersion !== latest) issues.push({ detail: `${bunVersion} behind latest ${latest}`, type: 'bun' })
  }
  const lintmaxLatest = await getLatestNpmVersion('lintmax')
  if (lintmaxLatest) {
    const result = await $`bun why lintmax`.cwd(projectPath).quiet().nothrow()
    const resolved = result.stdout.toString().trim()
    if (resolved && !resolved.includes(lintmaxLatest))
      issues.push({ detail: `resolved version behind latest ${lintmaxLatest}`, type: 'lintmax' })
  }
  issues.push(...checkPackageConventions(pkgs, projectPath))
  issues.push(...checkNotLatest(pkgs, projectPath))
  issues.push(...checkDuplicates(pkgs, projectPath))
  issues.push(...checkScripts(pkgs, projectPath))
  return issues
}
export type { Issue }
export { audit }
