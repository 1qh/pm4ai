import { $ } from 'bun'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Issue } from './types.js'
import { SWIFTBAR_FONT } from './constants.js'
import { getBunVersion, getGhRepo, projectName } from './utils.js'
const shellMetaRe = /[^\w\s./:@=-]/gu
const shellEscape = (s: string): string => s.replaceAll(shellMetaRe, String.raw`\$&`)
const isInfoOnly = (i: Issue) => i.type === 'info' || (i.type === 'check' && !i.detail.startsWith('failed'))
const hasRealIssues = (issues: Issue[]) => issues.some(i => !isInfoOnly(i))
const formatIssues = (projectPath: string, issues: Issue[]): string => {
  if (issues.length === 0) return projectPath
  const lines = [projectPath, ...issues.map(issue => `  ${issue.type} ${issue.detail}`)]
  return lines.join('\n')
}
const timeAgo = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
const getUiSyncTime = async (allPaths: string[]): Promise<string> => {
  const uiDirs = allPaths.map(p => join(p, 'readonly', 'ui', 'src')).filter(d => existsSync(d))
  if (uiDirs.length === 0) return '?'
  const r = await $`git log -1 --format=%ci -- readonly/ui`
    .cwd(allPaths.find(p => existsSync(join(p, 'readonly', 'ui', 'src'))) ?? '')
    .quiet()
    .nothrow()
  const out = r.stdout.toString().trim()
  return out ? timeAgo(new Date(out).toISOString()) : '?'
}
const formatSwiftBar = async (allIssues: Map<string, Issue[]>): Promise<string> => {
  const anyReal = [...allIssues.values()].some(hasRealIssues)
  const total = allIssues.size
  const clean = [...allIssues.values()].filter(i => !hasRealIssues(i)).length
  const totalIssues = [...allIssues.values()].flatMap(i => i.filter(x => x.type !== 'info')).length
  const paths = [...allIssues.keys()]
  const [repos, bunVer, uiSync] = await Promise.all([
    Promise.all(paths.map(async p => getGhRepo(p))),
    getBunVersion(),
    getUiSyncTime(paths)
  ])
  const repoMap = new Map(paths.map((p, i) => [p, repos[i]]))
  const lines: string[] = []
  if (anyReal) lines.push(`${clean}/${total} | sfimage=xmark.circle.fill sfcolor=red`)
  else lines.push(`${total}/${total} | sfimage=checkmark.circle.fill sfcolor=green`)
  const f = SWIFTBAR_FONT
  lines.push('---')
  lines.push(`${total} projects  ${totalIssues} issues  bun ${bunVer}  ui ${uiSync} ${f}`)
  lines.push('---')
  const maxName = Math.max(...[...allIssues.keys()].map(p => projectName(p).length))
  const allIssueLines: string[] = []
  for (const [path, issues] of allIssues) {
    const name = projectName(path).padEnd(maxName)
    const repo = repoMap.get(path)
    const ghUrl = repo ? `https://github.com/${repo}` : ''
    const ciInfo = issues.find(i => i.type === 'info' || i.type === 'ci')
    const ciTimestamp = ciInfo?.detail.split(' ').at(-1) ?? ''
    const ciTime = (ciTimestamp && !Number.isNaN(new Date(ciTimestamp).getTime()) ? timeAgo(ciTimestamp) : '').padEnd(6)
    const realIssues = issues.filter(i => i.type !== 'info')
    const mark = realIssues.length > 0 ? '🔴' : '🟢'
    const warn = realIssues.length > 0 ? ` ${realIssues.length} issues` : ''
    lines.push(`${mark} ${name}  ${ciTime}${warn} ${f}`)
    if (realIssues.length > 0)
      for (const issue of realIssues) {
        lines.push(`--${issue.detail} ${f} color=#ff6b6b`)
        allIssueLines.push(`${name.trim()}: ${issue.detail}`)
      }
    if (ghUrl) lines.push(`--GitHub | href=${ghUrl}`)
    lines.push(`--VS Code | bash=/usr/bin/open param1=-a param2=Visual\\ Studio\\ Code param3=${path} terminal=false`)
    lines.push(`--Ghostty | bash=/usr/bin/open param1=-a param2=Ghostty param3=--working-directory=${path} terminal=false`)
    if (realIssues.length > 0) {
      const issueText = realIssues.map(i => shellEscape(i.detail)).join(String.raw`\n`)
      lines.push(`--Copy Issues | bash=/bin/bash param1=-c param2='echo "${issueText}" | pbcopy' terminal=false`)
    }
  }
  if (totalIssues > 0) {
    lines.push('---')
    const allText = allIssueLines.map(l => shellEscape(l)).join(String.raw`\n`)
    lines.push(
      `Copy All Issues (${totalIssues}) | bash=/bin/bash param1=-c param2='echo "${allText}" | pbcopy' terminal=false`
    )
  }
  lines.push('---')
  lines.push('Refresh | refresh=true')
  return lines.join('\n')
}
export { formatIssues, formatSwiftBar, getUiSyncTime, hasRealIssues, shellEscape, timeAgo }
