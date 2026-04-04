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
  const allMdx = readdirSync(rulesDir).filter(f => f.endsWith('.mdx'))
  const ruleFiles = [...allMdx.filter(f => f === 'index.mdx'), ...allMdx.filter(f => f !== 'index.mdx').toSorted()]
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
export const syncPackageJson = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const pkgFile = file(join(projectPath, 'package.json'))
  if (!(await pkgFile.exists())) return issues
  const raw = await pkgFile.text()
  const pkg = JSON.parse(raw) as Record<string, unknown>
  let changed = false
  const scripts = (pkg.scripts ?? {}) as Record<string, string>
  if (!scripts.clean) {
    scripts.clean = 'sh clean.sh'
    changed = true
    issues.push({ detail: 'added clean script', type: 'synced' })
  }
  pkg.scripts = scripts
  if (!pkg['simple-git-hooks']) {
    pkg['simple-git-hooks'] = { 'pre-commit': 'sh up.sh && git add -u' }
    changed = true
    issues.push({ detail: 'added simple-git-hooks', type: 'synced' })
  }
  if (!scripts.prepare) {
    scripts.prepare = 'bunx simple-git-hooks'
    changed = true
    issues.push({ detail: 'added prepare script', type: 'synced' })
  }
  if (!scripts.postinstall?.includes('sherif')) {
    scripts.postinstall = scripts.postinstall ? `${scripts.postinstall} && sherif` : 'sherif'
    changed = true
    issues.push({ detail: 'added sherif to postinstall', type: 'synced' })
  }
  pkg.scripts = scripts
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>
  if (!devDeps.sherif) {
    devDeps.sherif = 'latest'
    pkg.devDependencies = devDeps
    changed = true
    issues.push({ detail: 'added sherif to devDependencies', type: 'synced' })
  }
  if (!devDeps['simple-git-hooks']) {
    devDeps['simple-git-hooks'] = 'latest'
    pkg.devDependencies = devDeps
    changed = true
    issues.push({ detail: 'added simple-git-hooks to devDependencies', type: 'synced' })
  }
  if (changed) await write(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`)
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
