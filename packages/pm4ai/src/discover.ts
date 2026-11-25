import { $, file } from 'bun'
import { mkdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { CONFIG_DIR } from './config-dir.js'
import { GH_ORG, LINTMAX_PKG, MONOREPO_NAME, PKG_NAME, READONLY_UI } from './constants.js'
import { pm4aiCloneBase, pm4aiHome } from './env.js'
import { parseJson } from './json.js'
import { debug, isNestedInRepo, projectName } from './utils.js'
interface Project {
  isCnsync: boolean
  isSelf: boolean
  name: string
  path: string
}
const isDirectory = async (p: string): Promise<boolean> => {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}
const hasDirInside = async (dir: string, sub: string): Promise<boolean> => isDirectory(join(dir, sub))
const hasLintmaxDep = async (dir: string): Promise<boolean> => {
  const pkgFile = file(join(dir, 'package.json'))
  if (!(await pkgFile.exists())) return false
  try {
    const pkg = parseJson<{
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }>(await pkgFile.text())
    return Boolean(
      pkg.dependencies?.[LINTMAX_PKG] ?? pkg.devDependencies?.[LINTMAX_PKG] ?? pkg.peerDependencies?.[LINTMAX_PKG]
    )
  } catch {
    return false
  }
}
const isCnsyncRepo = async (dir: string): Promise<boolean> => {
  if (!(await hasDirInside(dir, READONLY_UI))) return false
  const r = await $`git remote get-url origin`.cwd(dir).quiet().nothrow()
  const url = r.stdout.toString().trim()
  return url.includes(`${GH_ORG}/cnsync`)
}
const cloneBase = (): string => pm4aiCloneBase() ?? `https://github.com/${GH_ORG}`
const cloneSourceRepo = async (repo: string, dest: string) => {
  debug('cloning', repo, 'to', dest)
  await mkdir(dirname(dest), { recursive: true })
  await $`GIT_TERMINAL_PROMPT=0 git clone ${cloneBase()}/${repo}.git ${dest}`.quiet().nothrow()
}
const refreshSourceRepo = async (dest: string) => {
  await $`GIT_TERMINAL_PROMPT=0 git fetch --quiet --prune`.cwd(dest).quiet().nothrow()
  await $`git reset --hard @{u}`.cwd(dest).quiet().nothrow()
  await $`git clean -fd`.cwd(dest).quiet().nothrow()
}
const prepareSourceRepo = async (repo: string, dest: string): Promise<void> => {
  const doesDestExist = await isDirectory(dest)
  if (!doesDestExist) {
    await cloneSourceRepo(repo, dest)
    return
  }
  if (await isNestedInRepo(dest)) return
  await refreshSourceRepo(dest)
}
const ensureSourceRepo = async (repo: string, dest: string) => {
  await prepareSourceRepo(repo, dest)
  return dest
}
const rgExcludes = [
  '-g',
  '!**/node_modules/**',
  '-g',
  '!**/.cache/**',
  '-g',
  '!**/.Trash/**',
  '-g',
  '!**/Library/**',
  '-g',
  '!**/Applications/**',
  '-g',
  '!**/.local/**',
  '-g',
  '!**/.npm/**',
  '-g',
  '!**/.bun/**',
  '-g',
  '!**/.docker/**',
  '-g',
  '!**/iCloud*/**',
  '-g',
  '!**/.git/**'
]
const boundedRg = async (args: readonly string[], cwd?: string): Promise<string> => {
  const rg = Bun.spawn(['rg', ...args], { cwd, stderr: 'ignore', stdout: 'pipe', timeout: 15_000 })
  const out = await new Response(rg.stdout).text()
  await rg.exited
  return out.trim()
}
const selfProject = (path: string): Project => ({ isCnsync: false, isSelf: true, name: PKG_NAME, path })
const cnsyncProject = (path: string): Project => ({ isCnsync: true, isSelf: false, name: 'cnsync', path })
const findTurboRoots = async (home: string): Promise<string[]> => {
  const stdout = await boundedRg([
    '--files',
    home,
    '-g',
    'turbo.json',
    '-g',
    'turbo.jsonc',
    '--max-depth',
    '8',
    ...rgExcludes
  ])
  if (!stdout) debug('rg not found or returned empty')
  const found = stdout.split('\n').filter(Boolean)
  const allDirs = [...new Set(found.map(f => dirname(f)))].toSorted((a, b) => (a < b ? -1 : Number(a > b)))
  return allDirs.filter(dir => allDirs.every(other => other === dir || !dir.startsWith(`${other}/`)))
}
const toCandidate = async (dir: string, excludes: readonly string[]): Promise<Project | undefined> => {
  if (!(await hasLintmaxDep(dir))) return
  const name = projectName(dir)
  const isSelf = name === MONOREPO_NAME || name === PKG_NAME
  if (!isSelf && (excludes.includes(name) || excludes.includes(dir))) return
  return {
    isCnsync: await isCnsyncRepo(dir),
    isSelf,
    name,
    path: dir
  }
}
const discover = async (
  searchRoot?: string,
  excludes: readonly string[] = [],
  shouldResolveSources = true
): Promise<{
  cnsync: Project
  consumers: Project[]
  self: Project
}> => {
  const home = searchRoot ?? pm4aiHome() ?? homedir()
  const turboRoots = await findTurboRoots(home)
  const candidates = await Promise.all(turboRoots.map(async dir => toCandidate(dir, excludes)))
  const projects: Project[] = candidates.filter((p): p is Project => p !== undefined)
  const reposDir = join(home, CONFIG_DIR, 'repos')
  const self =
    projects.find(p => p.isSelf) ??
    selfProject(shouldResolveSources ? await ensureSourceRepo(PKG_NAME, join(reposDir, PKG_NAME)) : '')
  const cnsync =
    projects.find(p => p.isCnsync) ??
    cnsyncProject(shouldResolveSources ? await ensureSourceRepo('cnsync', join(reposDir, 'cnsync')) : '')
  const consumers = projects.filter(p => !(p.isSelf || p.isCnsync))
  return { cnsync, consumers, self }
}
const existingSource = async (
  repo: string,
  dir: string,
  make: (path: string) => Project
): Promise<Project | undefined> => {
  if (!(await isDirectory(dir))) return
  await ensureSourceRepo(repo, dir)
  return make(dir)
}
const fallbackSource = async (repo: string, dir: string, make: (path: string) => Project): Promise<Project> => {
  await ensureSourceRepo(repo, dir)
  return make(dir)
}
const searchSources = async (home: string): Promise<string[]> => {
  const stdout = await boundedRg([
    '-l',
    `"${PKG_NAME}"`,
    home,
    '-g',
    'package.json',
    '-g',
    '!**/node_modules/**',
    '-g',
    '!**/.cache/**',
    '--max-depth',
    '8',
    '--max-count',
    '1'
  ])
  return stdout
    .split('\n')
    .filter(Boolean)
    .map(f => dirname(f))
}
const findSelfIn = async (found: string[]): Promise<Project | undefined> => {
  const dir = found.find(d => {
    const n = d.split('/').pop()
    return n === PKG_NAME || n === MONOREPO_NAME
  })
  if (!dir) return
  const gitRoot = await $`git rev-parse --show-toplevel`.cwd(dir).quiet().nothrow()
  return selfProject(gitRoot.stdout.toString().trim() || dir)
}
const findCnsyncIn = async (found: string[]): Promise<Project | undefined> => {
  const checks = await Promise.all(found.map(async d => ({ d, is: await isCnsyncRepo(d) })))
  const match = checks.find(c => c.is)
  return match ? cnsyncProject(match.d) : undefined
}
const locateSources = async (
  home: string,
  selfDir: string,
  cnsyncDir: string
): Promise<{ cnsync: Project | undefined; self: Project | undefined }> => {
  const self = await existingSource(PKG_NAME, selfDir, selfProject)
  const cnsync = await existingSource('cnsync', cnsyncDir, cnsyncProject)
  if (self && cnsync) return { cnsync, self }
  const found = await searchSources(home)
  const foundSelf = self ?? (await findSelfIn(found))
  const foundCnsync = cnsync ?? (await findCnsyncIn(found))
  return { cnsync: foundCnsync, self: foundSelf }
}
const discoverSources = async (searchRoot?: string): Promise<{ cnsync: Project; self: Project }> => {
  const home = searchRoot ?? pm4aiHome() ?? homedir()
  const selfDir = join(home, CONFIG_DIR, 'repos', PKG_NAME)
  const cnsyncDir = join(home, CONFIG_DIR, 'repos', 'cnsync')
  const located = await locateSources(home, selfDir, cnsyncDir)
  const self = located.self ?? (await fallbackSource(PKG_NAME, selfDir, selfProject))
  const cnsync = located.cnsync ?? (await fallbackSource('cnsync', cnsyncDir, cnsyncProject))
  return { cnsync, self }
}
export type { Project }
export { boundedRg, discover, discoverSources, isCnsyncRepo }
