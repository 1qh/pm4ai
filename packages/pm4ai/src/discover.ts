import { $, file } from 'bun'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
interface Project {
  isCnsync: boolean
  isSelf: boolean
  name: string
  path: string
}
const readPkgName = async (dir: string): Promise<string | undefined> => {
  const f = file(join(dir, 'package.json'))
  if (!(await f.exists())) return
  const pkg = (await f.json()) as { name?: string }
  return pkg.name
}
const hasDirInside = (dir: string, sub: string) => existsSync(join(dir, sub))
const cloneIfMissing = async (repo: string, dest: string) => {
  if (existsSync(dest)) return dest
  mkdirSync(dirname(dest), { recursive: true })
  await $`git clone https://github.com/1qh/${repo}.git ${dest}`.quiet()
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
  const found = stdout.split('\n').filter(Boolean)
  const allDirs = [...new Set(found.map(f => dirname(f)))].toSorted()
  const projectDirs = allDirs.filter(dir => !allDirs.some(other => other !== dir && dir.startsWith(`${other}/`)))
  const projects: Project[] = await Promise.all(
    projectDirs.map(async dir => {
      const name = (await readPkgName(dir)) ?? dirname(dir).split('/').pop() ?? dir
      return {
        isCnsync: hasDirInside(dir, 'readonly/ui') && name !== 'pm4ai-monorepo',
        isSelf: name === 'pm4ai-monorepo' || name === 'pm4ai',
        name,
        path: dir
      }
    })
  )
  let self = projects.find(p => p.isSelf)
  let cnsync = projects.find(p => p.isCnsync)
  if (!self) {
    const dest = join(home, '.pm4ai', 'repos', 'pm4ai')
    await cloneIfMissing('pm4ai', dest)
    self = { isCnsync: false, isSelf: true, name: 'pm4ai', path: dest }
  }
  if (!cnsync) {
    const dest = join(home, '.pm4ai', 'repos', 'cnsync')
    await cloneIfMissing('cnsync', dest)
    cnsync = { isCnsync: true, isSelf: false, name: 'cnsync', path: dest }
  }
  const consumers = projects.filter(p => !p.isSelf)
  return { cnsync, consumers, self }
}
export type { Project }
export { discover }
