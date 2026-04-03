import { homedir } from 'os'
import { dirname, join } from 'path'
import { readFileSync, existsSync } from 'fs'

const runCapture = async (cmd: string[]) => {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  await proc.exited
  return stdout.trim()
}

export type Project = {
  name: string
  path: string
  isSelf: boolean
  isCnsync: boolean
}

const readPkgName = (dir: string): string | undefined => {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return undefined
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  return pkg.name
}

const hasDirInside = (dir: string, sub: string) => existsSync(join(dir, sub))

const cloneIfMissing = async (repo: string, dest: string) => {
  if (existsSync(dest)) return dest
  const { mkdirSync } = await import('fs')
  mkdirSync(dirname(dest), { recursive: true })
  await Bun.spawn(['git', 'clone', `https://github.com/1qh/${repo}.git`, dest], {
    stdout: 'ignore',
    stderr: 'ignore'
  }).exited
  return dest
}

export const discover = async (): Promise<{
  self: Project
  cnsync: Project
  consumers: Project[]
}> => {
  const home = homedir()
  const stdout = await runCapture([
    'rg', '-l', '"lintmax"', home,
    '-g', 'package.json',
    '-g', '!**/node_modules/**',
    '-g', '!**/.cache/**'
  ])

  const files = stdout.split('\n').filter(Boolean)
  const allDirs = [...new Set(files.map(f => dirname(f)))].sort()

  const projectDirs = allDirs.filter(dir =>
    !allDirs.some(other => other !== dir && dir.startsWith(other + '/'))
  )

  const projects: Project[] = projectDirs.map(dir => {
    const name = readPkgName(dir) ?? dirname(dir).split('/').pop() ?? dir
    return {
      name,
      path: dir,
      isSelf: name === 'pm4ai-monorepo' || name === 'pm4ai',
      isCnsync: hasDirInside(dir, 'readonly/ui') && name !== 'pm4ai-monorepo'
    }
  })

  let self = projects.find(p => p.isSelf)
  let cnsync = projects.find(p => p.isCnsync)

  if (!self) {
    const dest = join(home, '.pm4ai', 'repos', 'pm4ai')
    await cloneIfMissing('pm4ai', dest)
    self = { name: 'pm4ai', path: dest, isSelf: true, isCnsync: false }
  }

  if (!cnsync) {
    const dest = join(home, '.pm4ai', 'repos', 'cnsync')
    await cloneIfMissing('cnsync', dest)
    cnsync = { name: 'cnsync', path: dest, isSelf: false, isCnsync: true }
  }

  const consumers = projects.filter(p => !p.isSelf)

  return { self, cnsync, consumers }
}
