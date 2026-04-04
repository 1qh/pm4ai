import { file } from 'bun'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const parseFrontmatter = (content: string): Record<string, string> => {
  if (!content.startsWith('---')) return {}
  const endIdx = content.indexOf('---', 3)
  if (endIdx === -1) return {}
  const fm: Record<string, string> = {}
  for (const line of content.slice(3, endIdx).trim().split('\n')) {
    const colon = line.indexOf(':')
    if (colon > 0) fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  return fm
}
const getRulesDir = (): string | undefined => {
  const candidates = [
    join(import.meta.dir, '..', '..', '..', 'apps', 'web', 'content', 'rules'),
    join(import.meta.dir, '..', 'apps', 'web', 'content', 'rules')
  ]
  return candidates.find(c => existsSync(c))
}
const getAllDeps = async (projectPath: string): Promise<Set<string>> => {
  const deps = new Set<string>()
  const rootFile = file(join(projectPath, 'package.json'))
  if (!(await rootFile.exists())) return deps
  const rootPkg = (await rootFile.json()) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    workspaces?: string[]
  }
  const addDeps = (pkg: Record<string, Record<string, string> | undefined>) => {
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const d = pkg[field]
      if (d) for (const name of Object.keys(d)) deps.add(name)
    }
  }
  addDeps(rootPkg as Record<string, Record<string, string> | undefined>)
  const wsPkgPaths = (rootPkg.workspaces ?? []).flatMap(ws => {
    const wsDir = join(projectPath, ws.replace('/*', ''))
    if (!existsSync(wsDir)) return []
    return readdirSync(wsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => join(wsDir, e.name, 'package.json'))
  })
  const wsPkgs = await Promise.all(
    wsPkgPaths.map(async p => {
      const f = file(p)
      if (!(await f.exists())) return
      return (await f.json()) as Record<string, Record<string, string> | undefined>
    })
  )
  for (const pkg of wsPkgs) if (pkg) addDeps(pkg)
  return deps
}
const inferRules = async (projectPath: string, rulesDir?: string): Promise<string[]> => {
  const dir = rulesDir ?? getRulesDir()
  if (!(dir && existsSync(dir))) return []
  const deps = await getAllDeps(projectPath)
  const rules: string[] = []
  const mdxFiles = readdirSync(dir).filter(f => f.endsWith('.mdx'))
  const indexFile = mdxFiles.find(f => f === 'index.mdx')
  const sorted = [...(indexFile ? [indexFile] : []), ...mdxFiles.filter(f => f !== 'index.mdx').toSorted()]
  for (const mdxFile of sorted) {
    const content = readFileSync(join(dir, mdxFile), 'utf8')
    const fm = parseFrontmatter(content)
    const { infer } = fm
    if (!infer) {
      // Skip rules without infer field
    } else if (infer === 'always') rules.push(mdxFile.replace('.mdx', ''))
    else if (deps.has(infer)) rules.push(mdxFile.replace('.mdx', ''))
  }
  return rules
}
export { inferRules }
