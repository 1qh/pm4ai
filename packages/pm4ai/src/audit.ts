import { $, file } from 'bun'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
interface Issue {
  detail: string
  type: string
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
const collectPkgJsons = async (projectPath: string): Promise<{ path: string; pkg: Record<string, unknown> }[]> => {
  const rootPkgPath = join(projectPath, 'package.json')
  const rootFile = file(rootPkgPath)
  if (!(await rootFile.exists())) return []
  const rootPkg = (await rootFile.json()) as Record<string, unknown>
  const results = [{ path: rootPkgPath, pkg: rootPkg }]
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
          return { path: pkgPath, pkg: (await pkgFile.json()) as Record<string, unknown> }
        })
    })
  )
  for (const p of wsPkgs) if (p) results.push(p)
  return results
}
const isAutoSynced = (pkgPath: string) => pkgPath.includes('/readonly/') || pkgPath.includes('/lib/ui/')
const scanDeps = (
  pkgs: { path: string; pkg: Record<string, unknown> }[],
  projectPath: string
): { depIssues: Issue[]; duplicateIssues: Issue[] } => {
  const depIssues: Issue[] = []
  const allDeps = new Map<string, string[]>()
  for (const { path: pkgPath, pkg } of pkgs)
    if (isAutoSynced(pkgPath)) {
      // Skip auto-synced packages from dep audit
    } else {
      const shortPath = pkgPath.replace(`${projectPath}/`, '')
      const depEntries = ['dependencies', 'devDependencies'].flatMap(field => {
        const deps = pkg[field] as Record<string, string> | undefined
        return deps ? Object.entries(deps) : []
      })
      for (const [name, version] of depEntries) {
        if (version !== 'latest' && !version.startsWith('workspace:'))
          depIssues.push({ detail: `${name} not on latest tag (${version}) in ${shortPath}`, type: 'dep' })
        const locations = allDeps.get(name) ?? []
        locations.push(shortPath)
        allDeps.set(name, locations)
      }
    }

  const duplicateIssues: Issue[] = []
  for (const [name, locations] of allDeps)
    if (locations.length > 1 && !name.startsWith('@types/'))
      duplicateIssues.push({ detail: `${name} declared in ${locations.join(', ')}`, type: 'duplicate' })
  return { depIssues, duplicateIssues }
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
  const { depIssues, duplicateIssues } = scanDeps(pkgs, projectPath)
  issues.push(...depIssues, ...duplicateIssues)
  return issues
}
export type { Issue }
export { audit }
