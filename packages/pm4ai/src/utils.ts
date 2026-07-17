/** biome-ignore-all lint/performance/noAwaitInLoops: sequential parent-dir walk is dependent */
/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: intentional catch-swallow */
/* eslint-disable no-empty */
import { $, file, Glob, write } from 'bun'
import { access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PackageJson } from './types.js'
import { CONDITIONAL_VERBATIM_FILES, EXTENDABLE_VERBATIM_FILES, LINTMAX_PKG, VERBATIM_FILES } from './constants.js'

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
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
  return raw
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
  await Promise.all(
    positive.map(async ws => {
      const glob = new Glob(ws)
      for await (const match of glob.scan({ cwd: projectPath, onlyFiles: false }))
        if (!negated.has(match)) matched.add(match)
    })
  )
  const candidatePaths = [...matched].map(m => join(projectPath, m, 'package.json'))
  const candidateExists = await Promise.all(candidatePaths.map(async p => pathExists(p)))
  const wsPkgPaths = candidatePaths.filter((_, i) => candidateExists[i])
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
const findGitRoot = async (): Promise<string | undefined> => {
  let dir = process.cwd()
  while (dir !== '/') {
    // eslint-disable-next-line no-await-in-loop
    const hasGit = await pathExists(join(dir, '.git'))
    if (hasGit) return dir
    dir = dirname(dir)
  }
}
const isInsideProject = async (): Promise<string | undefined> => {
  const root = await findGitRoot()
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
interface Capabilities {
  fumadocs: boolean
  github: boolean
  publishable: boolean
  tailwind: boolean
}
const detectCapabilities = async (projectPath: string): Promise<Capabilities> => {
  const entries = await collectWorkspacePackages(projectPath)
  const allDeps = new Set<string>()
  for (const { pkg } of entries) {
    for (const k of Object.keys(pkg.dependencies ?? {})) allDeps.add(k)
    for (const k of Object.keys(pkg.devDependencies ?? {})) allDeps.add(k)
  }
  const github = Boolean(await getGhRepo(projectPath))
  const tailwind =
    allDeps.has('tailwindcss') ||
    allDeps.has('@tailwindcss/postcss') ||
    [...allDeps].some(d => d.startsWith('@tailwindcss/'))
  const fumadocs = allDeps.has('fumadocs-ui')
  const publishable = entries.some(({ pkg }) => pkg.name && !pkg.private)
  return { fumadocs, github, publishable, tailwind }
}
interface ManagedFile {
  extendable: boolean
  path: string
}
const resolveManagedFiles = async (projectPath: string): Promise<ManagedFile[]> => {
  const caps = await detectCapabilities(projectPath)
  const verbatim = VERBATIM_FILES.map(path => ({ extendable: EXTENDABLE_VERBATIM_FILES.has(path), path }))
  const conditional = CONDITIONAL_VERBATIM_FILES.filter(c => caps[c.when]).map(c => ({
    extendable: c.extendable ?? false,
    path: c.path
  }))
  return [...verbatim, ...conditional]
}
const normalizeTail = (content: string): string => content.trimEnd()
const isExtended = (canonical: string, consumer: string): boolean =>
  normalizeTail(consumer).startsWith(normalizeTail(canonical))
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
  detectCapabilities,
  getBunVersion,
  getGhRepo,
  getTsconfigTypes,
  gitCleanRe,
  isExtended,
  isInsideProject,
  isSkippedPath,
  projectName,
  readJson,
  readPkg,
  rel,
  resolveManagedFiles,
  setVerbose,
  writeJson
}
export type { ManagedFile }
export type { Capabilities }
