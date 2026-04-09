import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_DEP_FIELDS } from './types.js'
import { collectWorkspacePackages } from './utils.js'
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
  const entries = await collectWorkspacePackages(projectPath)
  for (const { pkg } of entries)
    for (const field of ALL_DEP_FIELDS) {
      const d = pkg[field]
      if (d) for (const name of Object.keys(d)) deps.add(name)
    }
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
    if (infer && (infer === 'always' || deps.has(infer))) rules.push(mdxFile.replace('.mdx', ''))
  }
  return rules
}
export { inferRules, parseFrontmatter }
