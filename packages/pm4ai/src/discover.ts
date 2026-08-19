import { $, file } from 'bun'
import { mkdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { CONFIG_DIR } from './config-dir.js'
import { GH_ORG, LINTMAX_PKG, MONOREPO_NAME, PKG_NAME, READONLY_UI } from './constants.js'
import { pm4aiCloneBase, pm4aiHome } from './env.js'
import { debug, isNestedInRepo, projectName } from './utils.js'
import { parseJson } from './json.js'
interface Project {
  isCnsync: boolean
  isSelf: boolean
  name: string
  path: string
}
const dirExists = async (p: string): Promise<boolean> => {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}
const hasDirInside = async (dir: string, sub: string): Promise<boolean> => dirExists(join(dir, sub))
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
const ensureSourceRepo = async (repo: string, dest: string) => {
  const destExists = await dirExists(dest)
  if (!destExists) {
    debug('cloning', repo, 'to', dest)
    await mkdir(dirname(dest), { recursive: true })
    await $`GIT_TERMINAL_PROMPT=0 git clone ${cloneBase()}/${repo}.git ${dest}`.quiet().nothrow()
    return dest
  }
  if (await isNestedInRepo(dest)) return dest
  await $`GIT_TERMINAL_PROMPT=0 git fetch --quiet --prune`.cwd(dest).quiet().nothrow()
  await $`git reset --hard @{u}`.cwd(dest).quiet().nothrow()
  await $`git clean -fd`.cwd(dest).quiet().nothrow()
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
const discover = async (
  searchRoot?: string,
  excludes: readonly string[] = [],
  resolveSources = true
): Promise<{
  cnsync: Project
  consumers: Project[]
  self: Project
}> => {
  const home = searchRoot ?? pm4aiHome() ?? homedir()
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
  const turboRoots = allDirs.filter(dir => !allDirs.some(other => other !== dir && dir.startsWith(`${other}/`)))
  const candidates = await Promise.all(
    turboRoots.map(async dir => {
      if (!(await hasLintmaxDep(dir))) return null
      const name = projectName(dir)
      const isSelf = name === MONOREPO_NAME || name === PKG_NAME
      if (!isSelf && (excludes.includes(name) || excludes.includes(dir))) return null
      return {
        isCnsync: await isCnsyncRepo(dir),
        isSelf,
        name,
        path: dir
      }
    })
  )
  const projects: Project[] = candidates.filter((p): p is Project => p !== null)
  let self = projects.find(p => p.isSelf)
  let cnsync = projects.find(p => p.isCnsync)
  const reposDir = join(home, CONFIG_DIR, 'repos')
  if (!self) {
    const dest = resolveSources ? await ensureSourceRepo(PKG_NAME, join(reposDir, PKG_NAME)) : ''
    self = { isCnsync: false, isSelf: true, name: PKG_NAME, path: dest }
  }
  if (!cnsync) {
    const dest = resolveSources ? await ensureSourceRepo('cnsync', join(reposDir, 'cnsync')) : ''
    cnsync = { isCnsync: true, isSelf: false, name: 'cnsync', path: dest }
  }
  const consumers = projects.filter(p => !(p.isSelf || p.isCnsync))
  return { cnsync, consumers, self }
}
// eslint-disable-next-line sonarjs/cognitive-complexity -- sequential source-repo resolution with layered fallbacks
const discoverSources = async (searchRoot?: string): Promise<{ cnsync: Project; self: Project }> => {
  const home = searchRoot ?? pm4aiHome() ?? homedir()
  const reposDir = join(home, CONFIG_DIR, 'repos')
  const selfDir = join(reposDir, PKG_NAME)
  const cnsyncDir = join(reposDir, 'cnsync')
  let self: Project | undefined
  let cnsync: Project | undefined
  const selfDirExists = await dirExists(selfDir)
  if (selfDirExists) {
    await ensureSourceRepo(PKG_NAME, selfDir)
    self = { isCnsync: false, isSelf: true, name: PKG_NAME, path: selfDir }
  }
  const cnsyncDirExists = await dirExists(cnsyncDir)
  if (cnsyncDirExists) {
    await ensureSourceRepo('cnsync', cnsyncDir)
    cnsync = { isCnsync: true, isSelf: false, name: 'cnsync', path: cnsyncDir }
  }
  if (!(self && cnsync)) {
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
    const found = stdout
      .split('\n')
      .filter(Boolean)
      .map(f => dirname(f))
    if (!self) {
      const dir = found.find(d => {
        const n = d.split('/').pop()
        return n === PKG_NAME || n === MONOREPO_NAME
      })
      if (dir) {
        const gitRoot = await $`git rev-parse --show-toplevel`.cwd(dir).quiet().nothrow()
        const root = gitRoot.stdout.toString().trim() || dir
        self = { isCnsync: false, isSelf: true, name: PKG_NAME, path: root }
      }
    }
    if (!cnsync) {
      const checks = await Promise.all(found.map(async d => ({ d, is: await isCnsyncRepo(d) })))
      const match = checks.find(c => c.is)
      if (match) cnsync = { isCnsync: true, isSelf: false, name: 'cnsync', path: match.d }
    }
  }
  if (!self) {
    await ensureSourceRepo(PKG_NAME, selfDir)
    self = { isCnsync: false, isSelf: true, name: PKG_NAME, path: selfDir }
  }
  if (!cnsync) {
    await ensureSourceRepo('cnsync', cnsyncDir)
    cnsync = { isCnsync: true, isSelf: false, name: 'cnsync', path: cnsyncDir }
  }
  return { cnsync, self }
}
export type { Project }
export { boundedRg, discover, discoverSources, isCnsyncRepo }
