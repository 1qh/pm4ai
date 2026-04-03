import { readFileSync, writeFileSync, existsSync, cpSync } from 'fs'
import { join } from 'path'
import { inferRules } from './infer.js'
import type { Issue } from './audit.js'

const verbatimFiles = ['clean.sh', 'up.sh', 'bunfig.toml', '.gitignore']

const stripFrontmatter = (content: string): string => {
  if (!content.startsWith('---')) return content
  const endIdx = content.indexOf('---', 3)
  if (endIdx === -1) return content
  return content.slice(endIdx + 3).trim()
}

export const syncConfigs = (selfPath: string, projectPath: string): Issue[] => {
  const issues: Issue[] = []

  for (const file of verbatimFiles) {
    const src = join(selfPath, file)
    const dst = join(projectPath, file)
    if (!existsSync(src)) {
      // Source file missing in pm4ai repo
    } else {
      const srcContent = readFileSync(src, 'utf-8')
      const dstContent = existsSync(dst) ? readFileSync(dst, 'utf-8') : ''
      if (srcContent !== dstContent) {
        writeFileSync(dst, srcContent)
        issues.push({ type: 'synced', detail: `${file} updated` })
      }
    }
  }

  return issues
}

export const syncClaudeMd = (selfPath: string, projectPath: string): Issue[] => {
  const issues: Issue[] = []
  const rulesDir = join(selfPath, 'apps', 'web', 'content', 'rules')

  if (!existsSync(rulesDir)) {
    issues.push({ type: 'error', detail: 'rules directory not found in pm4ai repo' })
    return issues
  }

  const inferred = inferRules(projectPath)
  const { readdirSync } = require('fs')
  const ruleFiles: string[] = readdirSync(rulesDir).filter((f: string) => f.endsWith('.mdx')).sort()

  const blocks: string[] = []
  for (const file of ruleFiles) {
    const ruleName = file.replace('.mdx', '')
    if (!inferred.includes(ruleName)) {
      // Rule not applicable to this project
    } else {
      const content = readFileSync(join(rulesDir, file), 'utf-8')
      blocks.push(stripFrontmatter(content))
    }
  }

  const generated = blocks.join('\n\n---\n\n') + '\n'
  const claudePath = join(projectPath, 'CLAUDE.md')
  const existing = existsSync(claudePath) ? readFileSync(claudePath, 'utf-8') : ''

  if (generated !== existing) {
    writeFileSync(claudePath, generated)
    issues.push({ type: 'synced', detail: 'CLAUDE.md updated' })
  }

  return issues
}

export const syncUi = (cnsyncPath: string, projectPath: string): Issue[] => {
  const issues: Issue[] = []
  const src = join(cnsyncPath, 'readonly', 'ui')
  const dst = join(projectPath, 'readonly', 'ui')

  if (!existsSync(src)) {
    issues.push({ type: 'error', detail: 'readonly/ui not found in cnsync repo' })
    return issues
  }

  if (projectPath === cnsyncPath) return issues

  cpSync(src, dst, { recursive: true })
  issues.push({ type: 'synced', detail: 'readonly/ui updated' })

  return issues
}
