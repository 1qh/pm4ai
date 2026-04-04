import { $ } from 'bun'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { MONOREPO_NAME, PKG_NAME, READONLY_UI } from './constants.js'
import { debug, readPkg } from './utils.js'
interface Project {
  isCnsync: boolean
  isSelf: boolean
  name: string
  path: string
}
const hasDirInside = (dir: string, sub: string) => existsSync(join(dir, sub))
const cloneIfMissing = async (repo: string, dest: string) => {
  if (existsSync(dest)) return dest
  debug('cloning', repo, 'to', dest)
  mkdirSync(dirname(dest), { recursive: true })
  const { GH_ORG } = await import('./constants.js')
  await $`git clone https://github.com/${GH_ORG}/${repo}.git ${dest}`.quiet().nothrow()
  return dest
}
const discover = async (): Promise<{
  cnsync: Project
  consumers: Project[]
  self: Project
}> => {
  const home = homedir()
  const result = await $`rg -l '"lintmax"' ${home} -g package.json -g '!**/node_modules/**' -g '!**/.cache/**'`
    .quiet()
    .nothrow()
  const stdout = result.stdout.toString().trim()
  if (!stdout) debug('rg not found or returned empty')
  const found = stdout.split('\n').filter(Boolean)
  const allDirs = [...new Set(found.map(f => dirname(f)))].toSorted()
  const projectDirs = allDirs.filter(dir => !allDirs.some(other => other !== dir && dir.startsWith(`${other}/`)))
  const projects: Project[] = await Promise.all(
    projectDirs.map(async dir => {
      const pkg = await readPkg(join(dir, 'package.json'))
      const name = pkg?.name ?? dirname(dir).split('/').pop() ?? dir
      return {
        isCnsync: hasDirInside(dir, READONLY_UI) && name !== MONOREPO_NAME,
        isSelf: name === MONOREPO_NAME || name === PKG_NAME,
        name,
        path: dir
      }
    })
  )
  let self = projects.find(p => p.isSelf)
  let cnsync = projects.find(p => p.isCnsync)
  if (!self) {
    const dest = join(home, '.pm4ai', 'repos', PKG_NAME)
    await cloneIfMissing(PKG_NAME, dest)
    self = { isCnsync: false, isSelf: true, name: PKG_NAME, path: dest }
  }
  if (!cnsync) {
    const dest = join(home, '.pm4ai', 'repos', 'cnsync')
    await cloneIfMissing('cnsync', dest)
    cnsync = { isCnsync: true, isSelf: false, name: 'cnsync', path: dest }
  }
  const consumers = projects.filter(p => !p.isSelf)
  return { cnsync, consumers, self }
}
const discoverSources = async (): Promise<{ cnsync: Project; self: Project }> => {
  const home = homedir()
  const reposDir = join(home, '.pm4ai', 'repos')
  const selfDir = join(reposDir, PKG_NAME)
  const cnsyncDir = join(reposDir, 'cnsync')
  let self: Project | undefined
  let cnsync: Project | undefined
  if (existsSync(selfDir)) self = { isCnsync: false, isSelf: true, name: PKG_NAME, path: selfDir }
  if (existsSync(cnsyncDir)) cnsync = { isCnsync: true, isSelf: false, name: 'cnsync', path: cnsyncDir }
  if (!(self && cnsync)) {
    const result =
      await $`rg -l '"${PKG_NAME}"' ${home} -g package.json -g '!**/node_modules/**' -g '!**/.cache/**' --max-count 1`
        .quiet()
        .nothrow()
    const found = result.stdout
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(f => dirname(f))
    if (!self) {
      const dir = found.find(d => {
        const name = d.split('/').pop()
        return name === PKG_NAME || name === MONOREPO_NAME
      })
      if (dir) {
        const gitRoot = await $`git rev-parse --show-toplevel`.cwd(dir).quiet().nothrow()
        const root = gitRoot.stdout.toString().trim() || dir
        self = { isCnsync: false, isSelf: true, name: PKG_NAME, path: root }
      }
    }
    if (!cnsync) {
      const dir = found.find(d => hasDirInside(d, READONLY_UI) && d.split('/').pop() !== MONOREPO_NAME)
      if (dir) cnsync = { isCnsync: true, isSelf: false, name: 'cnsync', path: dir }
    }
  }
  if (!self) {
    await cloneIfMissing(PKG_NAME, selfDir)
    self = { isCnsync: false, isSelf: true, name: PKG_NAME, path: selfDir }
  }
  if (!cnsync) {
    await cloneIfMissing('cnsync', cnsyncDir)
    cnsync = { isCnsync: true, isSelf: false, name: 'cnsync', path: cnsyncDir }
  }
  return { cnsync, self }
}
export type { Project }
export { discover, discoverSources }
