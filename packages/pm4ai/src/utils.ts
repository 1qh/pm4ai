/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: intentional catch-swallow */
/* oxlint-disable no-empty */
/* eslint-disable no-empty */
import { $, file, Glob, write } from 'bun'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { PackageJson } from './types.js'
import { LINTMAX_PKG } from './constants.js'
const readJson = async (path: string): Promise<Record<string, unknown> | undefined> => {
  const f = file(path)
  if (!(await f.exists())) return
  try {
    const raw: unknown = await f.json()
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw as Record<string, unknown>
  } catch {}
}
const readPkg = async (path: string): Promise<PackageJson | undefined> => {
  const raw = await readJson(path)
  return raw as PackageJson | undefined
}
const projectName = (path: string): string => path.split('/').pop() ?? ''
const getBunVersion = async (): Promise<string> => {
  const r = await $`bun --version`.quiet().nothrow()
  return r.stdout.toString().trim()
}
const ghRepoRe = /github\.com[/:](?<repo>[^/]+\/[^/.]+)/u
const getGhRepo = async (projectPath: string): Promise<string | undefined> => {
  const result = await $`git remote get-url origin`.cwd(projectPath).quiet().nothrow()
  return ghRepoRe.exec(result.stdout.toString().trim())?.groups?.repo
}
const collectWorkspacePackages = async (projectPath: string): Promise<{ path: string; pkg: PackageJson }[]> => {
  const rootPkgPath = join(projectPath, 'package.json')
  const rootPkg = await readPkg(rootPkgPath)
  if (!rootPkg) return []
  const results = [{ path: rootPkgPath, pkg: rootPkg }]
  const workspaces = rootPkg.workspaces ?? []
  const negated = new Set(workspaces.filter(w => w.startsWith('!')).map(w => w.slice(1)))
  const positive = workspaces.filter(w => !w.startsWith('!'))
  const matched = new Set<string>()
  for (const ws of positive) {
    const glob = new Glob(ws)
    for (const match of glob.scanSync({ cwd: projectPath, onlyFiles: false })) if (!negated.has(match)) matched.add(match)
  }
  const wsPkgPaths = [...matched].map(m => join(projectPath, m, 'package.json')).filter(p => existsSync(p))
  const wsPkgs = await Promise.all(
    wsPkgPaths.map(async p => {
      const pkg = await readPkg(p)
      return pkg ? { path: p, pkg } : undefined
    })
  )
  for (const wp of wsPkgs) if (wp) results.push(wp)
  return results
}
let verbose = false
const setVerbose = (v: boolean) => {
  verbose = v
}
const debug = (...args: unknown[]) => {
  if (verbose) console.error('[pm4ai]', ...args) // eslint-disable-line no-console
}
const findGitRoot = (): string | undefined => {
  let dir = process.cwd()
  while (dir !== '/') {
    if (existsSync(join(dir, '.git'))) return dir
    dir = dirname(dir)
  }
}
const isInsideProject = async (): Promise<string | undefined> => {
  const root = findGitRoot()
  if (!root) return
  const allPkgs = await collectWorkspacePackages(root)
  const hasLintmax = allPkgs.some(({ pkg }) => {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    return LINTMAX_PKG in deps
  })
  if (hasLintmax) return root
}
const rel = (fullPath: string, base: string) => fullPath.replace(`${base}/`, '')
const getTsconfigTypes = (config: Record<string, unknown>): string[] | undefined =>
  (config.compilerOptions as Record<string, unknown> | undefined)?.types as string[] | undefined
const writeJson = async (path: string, data: unknown) => write(file(path), `${JSON.stringify(data, null, 2)}\n`)
const isSkippedPath = (path: string) => path.includes('readonly/') || path.includes('.next/')
const gitCleanRe = /\bgit\s+clean\s+\S+\s*/gu
const buildPkgDepMap = (entries: { pkg: PackageJson }[]): Map<string, Set<string>> => {
  const result = new Map<string, Set<string>>()
  for (const { pkg } of entries)
    if (pkg.name) {
      const deps = new Set(
        Object.entries(pkg.dependencies ?? {})
          .filter(([n, v]) => !(v.startsWith('workspace:') || n.startsWith('@types/')))
          .map(([n]) => n)
      )
      result.set(pkg.name, deps)
    }
  return result
}
export {
  buildPkgDepMap,
  collectWorkspacePackages,
  debug,
  getBunVersion,
  getGhRepo,
  getTsconfigTypes,
  gitCleanRe,
  isInsideProject,
  isSkippedPath,
  projectName,
  readJson,
  readPkg,
  rel,
  setVerbose,
  writeJson
}
