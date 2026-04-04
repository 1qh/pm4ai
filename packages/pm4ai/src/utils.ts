/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: intentional catch-swallow */
/* oxlint-disable no-empty */
/* eslint-disable no-empty */
import { $, file } from 'bun'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
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
let verbose = false
const setVerbose = (v: boolean) => {
  verbose = v
}
const debug = (...args: unknown[]) => {
  if (verbose) console.error('[pm4ai]', ...args) // eslint-disable-line no-console
}
export { collectWorkspacePackages, debug, getBunVersion, getGhRepo, projectName, readJson, readPkg, setVerbose }
