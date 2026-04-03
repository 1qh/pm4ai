import { file, write } from 'bun'
import { cpSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Issue } from './audit.js'
import { inferRules } from './infer.js'
const verbatimFiles = ['clean.sh', 'up.sh', 'bunfig.toml', '.gitignore']
const stripFrontmatter = (content: string): string => {
  if (!content.startsWith('---')) return content
  const endIdx = content.indexOf('---', 3)
  if (endIdx === -1) return content
  return content.slice(endIdx + 3).trim()
}
export const syncConfigs = async (selfPath: string, projectPath: string): Promise<Issue[]> => {
  const results = await Promise.all(
    verbatimFiles.map(async name => {
      const src = file(join(selfPath, name))
      const dst = file(join(projectPath, name))
      if (!(await src.exists())) return
      const srcContent = await src.text()
      const dstContent = (await dst.exists()) ? await dst.text() : ''
      if (srcContent !== dstContent) {
        await write(dst, srcContent)
        return { detail: `${name} updated`, type: 'synced' } as Issue
      }
    })
  )
  return results.filter((r): r is Issue => r !== undefined)
}
export const syncClaudeMd = async (selfPath: string, projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const rulesDir = join(selfPath, 'apps', 'web', 'content', 'rules')
  if (!existsSync(rulesDir)) {
    issues.push({ detail: 'rules directory not found in pm4ai repo', type: 'error' })
    return issues
  }
  const inferred = await inferRules(projectPath)
  const ruleFiles = readdirSync(rulesDir)
    .filter(f => f.endsWith('.mdx'))
    .toSorted()
  const contents = await Promise.all(
    ruleFiles
      .filter(entry => inferred.includes(entry.replace('.mdx', '')))
      .map(async entry => file(join(rulesDir, entry)).text())
  )
  const blocks = contents.map(c => stripFrontmatter(c))
  const generated = `${blocks.join('\n\n---\n\n')}\n`
  const claudeFile = file(join(projectPath, 'CLAUDE.md'))
  const existing = (await claudeFile.exists()) ? await claudeFile.text() : ''
  if (generated !== existing) {
    await write(claudeFile, generated)
    issues.push({ detail: 'CLAUDE.md updated', type: 'synced' })
  }
  return issues
}
export const syncUi = (cnsyncPath: string, projectPath: string): Issue[] => {
  const issues: Issue[] = []
  const src = join(cnsyncPath, 'readonly', 'ui')
  const dst = join(projectPath, 'readonly', 'ui')
  if (!existsSync(src)) {
    issues.push({ detail: 'readonly/ui not found in cnsync repo', type: 'error' })
    return issues
  }
  if (projectPath === cnsyncPath) return issues
  cpSync(src, dst, { recursive: true })
  issues.push({ detail: 'readonly/ui updated', type: 'synced' })
  return issues
}
