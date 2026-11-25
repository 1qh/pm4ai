/** biome-ignore-all lint/performance/noAwaitInLoops: sequential parent-dir walk is dependent */
/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: intentional catch-swallow */
/* eslint-disable no-empty */
import { $, file, Glob, write } from 'bun'
import { access, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PackageJson } from './types.js'
import { CONDITIONAL_VERBATIM_FILES, EXTENDABLE_VERBATIM_FILES, LINTMAX_PKG, VERBATIM_FILES } from './constants.js'
import { parseJson } from './json.js'
const doesPathExist = async (path: string): Promise<boolean> => {
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
    const raw: unknown = parseJson<unknown>(await f.text())
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw
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
interface WorkspacePackage {
  path: string
  pkg: PackageJson
}
const scanWorkspaceDirs = async (projectPath: string, workspaces: string[]): Promise<string[]> => {
  const negated = new Set(workspaces.filter(w => w.startsWith('!')).map(w => w.slice(1)))
  const positive = workspaces.filter(w => !w.startsWith('!'))
  const scanned = await Promise.all(
    positive.map(async ws => Array.fromAsync(new Glob(ws).scan({ cwd: projectPath, onlyFiles: false })))
  )
  return [...new Set(scanned.flat().filter(m => !negated.has(m)))]
}
const readWorkspacePkgs = async (projectPath: string, dirs: string[]): Promise<WorkspacePackage[]> => {
  const candidatePaths = dirs.map(m => join(projectPath, m, 'package.json'))
  const candidateExists = await Promise.all(candidatePaths.map(async p => doesPathExist(p)))
  const wsPkgs = await Promise.all(
    candidatePaths
      .filter((_, i) => candidateExists[i])
      .map(async p => {
        const pkg = await readPkg(p)
        return pkg ? { path: p, pkg } : undefined
      })
  )
  return wsPkgs.filter((wp): wp is WorkspacePackage => wp !== undefined)
}
const collectWorkspacePackages = async (projectPath: string): Promise<WorkspacePackage[]> => {
  const rootPkgPath = join(projectPath, 'package.json')
  const rootPkg = await readPkg(rootPkgPath)
  if (!rootPkg) return []
  const dirs = await scanWorkspaceDirs(projectPath, rootPkg.workspaces ?? [])
  const wsPkgs = await readWorkspacePkgs(projectPath, dirs)
  return [{ path: rootPkgPath, pkg: rootPkg }, ...wsPkgs]
}
let isVerbose = false
const setVerbose = (shouldLog: boolean) => {
  isVerbose = shouldLog
}
const debug = (...args: unknown[]) => {
  if (isVerbose) console.error('[pm4ai]', ...args) // eslint-disable-line no-console
}
const findGitRoot = async (): Promise<string | undefined> => {
  let dir = process.cwd()
  while (dir !== '/') {
    // eslint-disable-next-line no-await-in-loop
    const hasGit = await doesPathExist(join(dir, '.git'))
    if (hasGit) return dir
    dir = dirname(dir)
  }
}
const projectRootOf = async (): Promise<string | undefined> => {
  const root = await findGitRoot()
  if (!root) return
  const allPkgs = await collectWorkspacePackages(root)
  const hasLintmax = allPkgs.some(({ pkg }) => {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    return LINTMAX_PKG in deps
  })
  if (hasLintmax) return root
}
const gitTopLevel = async (dir: string): Promise<string | undefined> => {
  const root = await $`git rev-parse --show-toplevel`.cwd(dir).quiet().nothrow()
  if (root.exitCode !== 0) return
  const top = root.stdout.toString().trim()
  return top === '' ? undefined : top
}
const isNestedInRepo = async (dir: string): Promise<boolean> => {
  const top = await gitTopLevel(dir)
  if (!top) return false
  try {
    const [realTop, realDir] = await Promise.all([realpath(top), realpath(dir)])
    return realTop !== realDir
  } catch {
    return false
  }
}
const ancestorChain = (dir: string): string[] => {
  const chain: string[] = [dir]
  let current = dir
  let parent = dirname(current)
  while (parent !== current) {
    chain.push(parent)
    current = parent
    parent = dirname(current)
  }
  return chain
}
const isInsideExistingRepo = async (dir: string): Promise<boolean> => {
  const chain = ancestorChain(dir)
  const existing = chain[(await Promise.all(chain.map(doesPathExist))).findIndex(Boolean)]
  if (existing === undefined) return false
  const top = await gitTopLevel(existing)
  if (!top) return false
  try {
    const [realTop, realExisting] = await Promise.all([realpath(top), realpath(existing)])
    return realTop !== realExisting || !(await doesPathExist(dir))
  } catch {
    return false
  }
}
const rel = (fullPath: string, base: string) => fullPath.replace(`${base}/`, '')
interface TsconfigTypesShape {
  types?: unknown
}
const getTsconfigTypes = (config: Record<string, unknown>): string[] | undefined => {
  const { compilerOptions } = config
  if (typeof compilerOptions !== 'object' || compilerOptions === null || Array.isArray(compilerOptions)) return
  /** biome-ignore lint/nursery/noUnsafeTypeAssertion: compilerOptions comes from validated JSON and only its types field is read */
  const options = compilerOptions as TsconfigTypesShape
  return Array.isArray(options.types) && options.types.every((type): type is string => typeof type === 'string')
    ? options.types
    : undefined
}
const writeJson = async (path: string, data: unknown) => write(file(path), `${JSON.stringify(data, undefined, 2)}\n`)
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
  const allDeps = new Set(
    entries.flatMap(({ pkg }) => [Object.keys(pkg.dependencies ?? {}), Object.keys(pkg.devDependencies ?? {})].flat())
  )
  const hasGithub = Boolean(await getGhRepo(projectPath))
  const tailwind =
    allDeps.has('tailwindcss') ||
    allDeps.has('@tailwindcss/postcss') ||
    [...allDeps].some(d => d.startsWith('@tailwindcss/'))
  const fumadocs = allDeps.has('fumadocs-ui')
  const isPublishable = entries.some(({ pkg }) => pkg.name && !pkg.private)
  return { fumadocs, github: hasGithub, publishable: isPublishable, tailwind }
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
/** Conditional files a project USED to warrant and no longer does, so a leftover copy from when it had that
 * capability is stale cruft — a publishable-only prune-versions.ts sitting in a repo that is now private,
 * which sync neither refreshes nor removes, so it drifts forever while `fix` reports zero-diff because it is
 * no longer managed. github is excluded: it is detected from the git remote, which is transiently absent
 * mid-setup, and deleting a workflow on that false negative is destructive and not self-evidently
 * recoverable, where a content-based capability (publishable, fumadocs, tailwind) is stable. */
const staleConditionalFiles = async (projectPath: string): Promise<string[]> => {
  const caps = await detectCapabilities(projectPath)
  return CONDITIONAL_VERBATIM_FILES.filter(c => c.when !== 'github' && !caps[c.when]).map(c => c.path)
}
const normalizeTail = (content: string): string => content.trimEnd()
const isExtended = (canonical: string, consumer: string): boolean =>
  normalizeTail(consumer).startsWith(normalizeTail(canonical))
/** Rewrite an extendable file's canonical part while KEEPING whatever the project added to it. The
 * starts-with test only recognises an extension while the canonical prefix is unchanged, so the run that
 * changes that prefix is exactly the run where every consumer stops matching — and writing the canonical
 * content wholesale there deletes each project's own entries. The extension is a trailing suffix by
 * construction (isExtended requires the consumer to start with canonical), so recover it as the VERBATIM
 * block after canonical's own last line. A trimmed-line dedup — the earlier approach — drops a nested key
 * whose trimmed form collides with a canonical line elsewhere (a step-level `env:` colliding with another
 * step's `env:`), orphaning its children onto the wrong indentation and producing invalid YAML the moment
 * the canonical prefix changes. The verbatim tail keeps the nesting intact; when canonical's own last line
 * is absent from the consumer (a flat file whose canonical lines were rewritten) it falls back to
 * line-identity recovery, never worse than before. */
const mergeExtendable = (canonical: string, consumer: string): string => {
  const consumerLines = consumer.split('\n').map(line => line.trimEnd())
  const lastCanonical = canonical
    .split('\n')
    .map(line => line.trimEnd())
    .findLast(line => line.trim() !== '')
  const anchor = lastCanonical === undefined ? -1 : consumerLines.lastIndexOf(lastCanonical)
  if (anchor !== -1) {
    const extension = consumerLines.slice(anchor + 1)
    while (extension.length > 0 && extension.at(-1) === '') extension.pop()
    return extension.length > 0 ? `${normalizeTail(canonical)}\n${extension.join('\n')}\n` : canonical
  }
  const owned = new Set(
    canonical
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
  )
  const extras = consumerLines.filter(line => line.trim() !== '' && !owned.has(line.trim()))
  return extras.length > 0 ? `${normalizeTail(canonical)}\n${extras.join('\n')}\n` : canonical
}
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
const providedByWorkspaces = (wsDeps: string[], pkgDepsByName: Map<string, Set<string>>): Set<string> => {
  const provided = new Set<string>()
  for (const ws of wsDeps) {
    const deps = pkgDepsByName.get(ws) ?? []
    for (const dep of deps) provided.add(dep)
  }
  return provided
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
  isInsideExistingRepo,
  isNestedInRepo,
  isSkippedPath,
  type ManagedFile,
  mergeExtendable,
  projectName,
  projectRootOf,
  providedByWorkspaces,
  readJson,
  readPkg,
  rel,
  resolveManagedFiles,
  setVerbose,
  staleConditionalFiles,
  writeJson
}
export type { Capabilities }
