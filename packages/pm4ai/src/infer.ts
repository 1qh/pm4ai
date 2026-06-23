/** biome-ignore-all lint/performance/noAwaitInLoops: ordered probe returns first match */
import { file } from 'bun'
import { readdir } from 'node:fs/promises'
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
const dirExists = async (dir: string): Promise<boolean> => {
  try {
    await readdir(dir)
    return true
  } catch {
    return false
  }
}
const getRulesDir = async (): Promise<string | undefined> => {
  const candidates = [
    join(import.meta.dir, '..', '..', '..', 'apps', 'web', 'content', 'rules'),
    join(import.meta.dir, '..', 'apps', 'web', 'content', 'rules')
  ]
  // eslint-disable-next-line no-await-in-loop
  for (const c of candidates) if (await dirExists(c)) return c
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
  const dir = rulesDir ?? (await getRulesDir())
  if (!(dir && (await dirExists(dir)))) return []
  const deps = await getAllDeps(projectPath)
  const mdxFiles = (await readdir(dir)).filter(f => f.endsWith('.mdx'))
  const indexFile = mdxFiles.find(f => f === 'index.mdx')
  const sorted = [...(indexFile ? [indexFile] : []), ...mdxFiles.filter(f => f !== 'index.mdx').toSorted()]
  const parsed = await Promise.all(
    sorted.map(async mdxFile => ({ fm: parseFrontmatter(await file(join(dir, mdxFile)).text()), mdxFile }))
  )
  const rules: string[] = []
  for (const { fm, mdxFile } of parsed) {
    const { infer } = fm
    if (infer && (infer === 'always' || deps.has(infer))) rules.push(mdxFile.replace('.mdx', ''))
  }
  return rules
}
export { inferRules, parseFrontmatter }
