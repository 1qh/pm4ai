import { file } from 'bun'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const alwaysRules = ['index', 'bun', 'typescript', 'code-quality', 'lintmax', 'git']
const depRuleMap: Record<string, string[]> = {
  next: ['react-nextjs'],
  playwright: ['testing'],
  tailwindcss: ['minimal-dom', 'shadcn'],
  tsdown: ['tsdown']
}
const getPkgPaths = (projectPath: string): string[] => {
  const rootPkgPath = join(projectPath, 'package.json')
  const paths = [rootPkgPath]
  if (!existsSync(rootPkgPath)) return paths
  const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8')) as { workspaces?: string[] }
  const workspaces = rootPkg.workspaces ?? []
  for (const ws of workspaces) {
    const wsDir = join(projectPath, ws.replace('/*', ''))
    if (existsSync(wsDir)) {
      const entries = readdirSync(wsDir, { withFileTypes: true })
      for (const entry of entries) if (entry.isDirectory()) paths.push(join(wsDir, entry.name, 'package.json'))
    }
  }
  return paths
}
const getAllDeps = async (projectPath: string): Promise<Set<string>> => {
  const deps = new Set<string>()
  const pkgPaths = getPkgPaths(projectPath)
  const pkgs = await Promise.all(
    pkgPaths.map(async p => {
      const f = file(p)
      if (!(await f.exists())) return
      return (await f.json()) as Record<string, Record<string, string> | undefined>
    })
  )
  const depFields = ['dependencies', 'devDependencies', 'peerDependencies'] as const
  const names = pkgs
    .filter((p): p is NonNullable<typeof p> => p !== undefined)
    .flatMap(pkg => depFields.flatMap(field => (pkg[field] ? Object.keys(pkg[field]) : [])))
  for (const name of names) deps.add(name)
  return deps
}
export const inferRules = async (projectPath: string): Promise<string[]> => {
  const deps = await getAllDeps(projectPath)
  const rules = [...alwaysRules]
  for (const [dep, ruleNames] of Object.entries(depRuleMap))
    if (deps.has(dep)) for (const rule of ruleNames) if (!rules.includes(rule)) rules.push(rule)
  return rules
}
