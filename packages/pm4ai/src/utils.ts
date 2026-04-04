import { $, file } from 'bun'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { PackageJson } from './types.js'
const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
    // biome-ignore lint/suspicious/noEmptyBlockStatements: safe
  } catch {} // eslint-disable-line no-empty
}
const readJson = async <T>(path: string): Promise<T | undefined> => {
  const f = file(path)
  if (!(await f.exists())) return
  const text = await f.text()
  return parseJson(text) as T | undefined
}
const readPkg = async (path: string) => readJson<PackageJson>(path)
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
  const wsPkgPaths = (rootPkg.workspaces ?? []).flatMap(ws => {
    const wsDir = join(projectPath, ws.replace('/*', ''))
    if (!existsSync(wsDir)) return []
    return readdirSync(wsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => join(wsDir, e.name, 'package.json'))
  })
  const wsPkgs = await Promise.all(
    wsPkgPaths.map(async p => {
      const pkg = await readPkg(p)
      return pkg ? { path: p, pkg } : undefined
    })
  )
  for (const wp of wsPkgs) if (wp) results.push(wp)
  return results
}
export { collectWorkspacePackages, getBunVersion, getGhRepo, projectName, readJson, readPkg }
