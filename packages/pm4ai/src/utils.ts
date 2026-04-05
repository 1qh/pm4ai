/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: intentional catch-swallow */
/** biome-ignore-all lint/correctness/noUndeclaredVariables: Bun global */
/* oxlint-disable no-empty */
/* eslint-disable no-empty */
import { $, file } from 'bun'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { PackageJson } from './types.js'
const readJson = async (path: string): Promise<unknown> => {
  const f = file(path)
  if (!(await f.exists())) return
  try {
    return (await f.json()) as unknown
  } catch {}
}
const isPkg = (v: unknown): v is PackageJson => typeof v === 'object' && v !== null && !Array.isArray(v)
const readPkg = async (path: string): Promise<PackageJson | undefined> => {
  const raw = await readJson(path)
  return isPkg(raw) ? raw : undefined
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
    const glob = new Bun.Glob(ws)
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
    return 'lintmax' in deps
  })
  if (hasLintmax) return root
}
export {
  collectWorkspacePackages,
  debug,
  getBunVersion,
  getGhRepo,
  isInsideProject,
  projectName,
  readJson,
  readPkg,
  setVerbose
}
