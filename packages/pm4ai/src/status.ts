/* eslint-disable no-console */
import { $, file } from 'bun'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Issue } from './audit.js'
import { audit } from './audit.js'
import { discover } from './discover.js'
import { readLog } from './log.js'
const checkGit = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const statusResult = await $`git status --porcelain`.cwd(projectPath).quiet().nothrow()
  const statusOut = statusResult.stdout.toString().trim()
  if (statusOut) {
    const count = statusOut.split('\n').length
    issues.push({ detail: `${count} uncommitted changes`, type: 'git' })
  }
  await $`git fetch`.cwd(projectPath).quiet().nothrow()
  const behindResult = await $`git rev-list --count HEAD..@{u}`.cwd(projectPath).quiet().nothrow()
  const behind = Number.parseInt(behindResult.stdout.toString().trim(), 10)
  if (behind > 0) issues.push({ detail: `${behind} commits behind remote`, type: 'git' })
  const aheadResult = await $`git rev-list --count @{u}..HEAD`.cwd(projectPath).quiet().nothrow()
  const ahead = Number.parseInt(aheadResult.stdout.toString().trim(), 10)
  if (ahead > 0) issues.push({ detail: `${ahead} commits ahead of remote`, type: 'git' })
  return issues
}
const checkDrift = async (selfPath: string, projectPath: string): Promise<Issue[]> => {
  const names = ['clean.sh', 'up.sh', 'bunfig.toml', '.gitignore']
  const results = await Promise.all(
    names.map(async name => {
      const src = file(join(selfPath, name))
      const dst = file(join(projectPath, name))
      if (!(await src.exists())) return
      if (!(await dst.exists())) return { detail: `${name} missing`, type: 'file' } as Issue
      const [srcContent, dstContent] = await Promise.all([src.text(), dst.text()])
      if (srcContent !== dstContent) return { detail: `${name} out of sync`, type: 'file' } as Issue
    })
  )
  return results.filter((r): r is Issue => r !== undefined)
}
const checkExists = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const mustExist = [
    'turbo.json',
    'tsconfig.json',
    '.github/workflows/ci.yml',
    'LEARNING.md',
    'RULES.md',
    'PROGRESS.md',
    'PLAN.md'
  ]
  for (const entry of mustExist) if (!existsSync(join(projectPath, entry))) issues.push({ detail: entry, type: 'missing' })
  const pkgFile = file(join(projectPath, 'package.json'))
  if (await pkgFile.exists()) {
    const pkg = (await pkgFile.json()) as {
      scripts?: Record<string, string>
      'simple-git-hooks'?: unknown
    }
    if (!pkg['simple-git-hooks']) issues.push({ detail: 'simple-git-hooks in package.json', type: 'missing' })
    if (!pkg.scripts?.prepare) issues.push({ detail: 'prepare script in package.json', type: 'missing' })
  }
  if (existsSync(join(projectPath, 'lib', 'ui')))
    issues.push({ detail: 'lib/ui should be migrated to readonly/ui', type: 'migrate' })
  return issues
}
const formatIssues = (projectPath: string, issues: Issue[]): string => {
  if (issues.length === 0) return ''
  const lines = [projectPath, ...issues.map(issue => `  ${issue.type} ${issue.detail}`)]
  return lines.join('\n')
}
const formatSwiftBar = (allIssues: Map<string, Issue[]>): string => {
  const hasAny = [...allIssues.values()].some(i => i.length > 0)
  const lines: string[] = []
  if (hasAny) lines.push(':xmark.circle.fill: | sfcolor=red')
  else lines.push(':checkmark.circle.fill: | sfcolor=green')
  lines.push('---')
  for (const [path, issues] of allIssues) {
    const name = path.split('/').pop() ?? path
    if (issues.length === 0) lines.push(`${name} | sfimage=checkmark.circle sfcolor=green`)
    else {
      lines.push(`${name} | sfimage=xmark.circle sfcolor=red`)
      for (const issue of issues) lines.push(`--${issue.type}: ${issue.detail}`)
    }
  }
  return lines.join('\n')
}
export const status = async (swiftbar = false) => {
  const { consumers, self } = await discover()
  const log = readLog()
  const allIssues = new Map<string, Issue[]>()
  const checks = consumers.map(async project => {
    const issues: Issue[] = []
    const [gitIssues, driftIssues, existIssues, auditIssues] = await Promise.all([
      checkGit(project.path),
      checkDrift(self.path, project.path),
      checkExists(project.path),
      audit(project.path)
    ])
    issues.push(...gitIssues, ...driftIssues, ...existIssues, ...auditIssues)
    const logEntry = log.find(e => e.path === project.path)
    if (logEntry && !logEntry.pass) issues.push({ detail: `failed ${logEntry.at}`, type: 'up.sh' })
    allIssues.set(project.path, issues)
  })
  await Promise.all(checks)
  if (swiftbar) console.log(formatSwiftBar(allIssues))
  else
    for (const [path, issues] of allIssues) {
      const output = formatIssues(path, issues)
      if (output) {
        console.log(output)
        console.log()
      }
    }
}
