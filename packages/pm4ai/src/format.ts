import { $ } from 'bun'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Issue } from './types.js'
import { SWIFTBAR_FONT } from './constants.js'
import { getBunVersion, getGhRepo, projectName } from './utils.js'
const shellMetaRe = /[^\w\s./:@=-]/gu
const shellEscape = (s: string): string => s.replaceAll(shellMetaRe, String.raw`\$&`)
const isInfoOnly = (i: Issue) => i.type === 'info' || (i.type === 'check' && !i.detail.startsWith('failed'))
const hasRealIssues = (issues: Issue[]) => issues.some(i => !isInfoOnly(i))
const formatIssues = (projectPath: string, issues: Issue[]): string => {
  const real = issues.filter(i => !isInfoOnly(i))
  if (real.length === 0) return `${projectPath}\n  ok`
  const lines = [projectPath, ...real.map(issue => `  ${issue.type} ${issue.detail}`)]
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
const isDirectory = async (p: string): Promise<boolean> => {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}
const getUiSyncTime = async (allPaths: string[]): Promise<string> => {
  const presence = await Promise.all(allPaths.map(async p => isDirectory(join(p, 'readonly', 'ui', 'src'))))
  const firstWithUi = allPaths.find((_p, i) => presence[i])
  if (firstWithUi === undefined) return '?'
  const r = await $`git log -1 --format=%ci -- readonly/ui`.cwd(firstWithUi).quiet().nothrow()
  const out = r.stdout.toString().trim()
  return out ? timeAgo(new Date(out).toISOString()) : '?'
}
const ciTimeOf = (issues: Issue[]): string => {
  const ciInfo = issues.find(i => i.type === 'info' || i.type === 'ci')
  const ciTimestamp = ciInfo?.detail.split(' ').at(-1) ?? ''
  return (ciTimestamp && !Number.isNaN(new Date(ciTimestamp).getTime()) ? timeAgo(ciTimestamp) : '').padEnd(6)
}
const projectMenu = ({
  issues,
  name,
  path,
  repo
}: {
  issues: Issue[]
  name: string
  path: string
  repo: string | undefined
}): { issueLines: string[]; lines: string[] } => {
  const f = SWIFTBAR_FONT
  const realIssues = issues.filter(i => i.type !== 'info')
  const hasIssues = realIssues.length > 0
  const issueText = realIssues.map(i => shellEscape(i.detail)).join(String.raw`\n`)
  const issueCount = hasIssues ? ` ${realIssues.length} issues` : ''
  const lines = [
    `${hasIssues ? '🔴' : '🟢'} ${name}  ${ciTimeOf(issues)}${issueCount} ${f}`,
    ...realIssues.map(issue => `--${issue.detail} ${f} color=#ff6b6b`),
    ...(repo ? [`--GitHub | href=https://github.com/${repo}`] : []),
    `--VS Code | bash=/usr/bin/open param1=-a param2=Visual\\ Studio\\ Code param3=${path} terminal=false`,
    `--Ghostty | bash=/usr/bin/open param1=-a param2=Ghostty param3=--working-directory=${path} terminal=false`,
    ...(hasIssues ? [`--Copy Issues | bash=/bin/bash param1=-c param2='echo "${issueText}" | pbcopy' terminal=false`] : [])
  ]
  return { issueLines: realIssues.map(issue => `${name.trim()}: ${issue.detail}`), lines }
}
const countRealIssues = (allIssues: Map<string, Issue[]>): number =>
  [...allIssues.values()].flatMap(i => i.filter(x => x.type !== 'info')).length
const swiftBarHeader = ({
  allIssues,
  bunVer,
  uiSync
}: {
  allIssues: Map<string, Issue[]>
  bunVer: string
  uiSync: string
}): string[] => {
  const total = allIssues.size
  const clean = [...allIssues.values()].filter(i => !hasRealIssues(i)).length
  const status = [...allIssues.values()].some(hasRealIssues)
    ? `${clean}/${total} | sfimage=xmark.circle.fill sfcolor=red`
    : `${total}/${total} | sfimage=checkmark.circle.fill sfcolor=green`
  return [
    status,
    '---',
    `${total} projects  ${countRealIssues(allIssues)} issues  bun ${bunVer}  ui ${uiSync} ${SWIFTBAR_FONT}`,
    '---'
  ]
}
const copyAllLines = (allIssueLines: string[], totalIssues: number): string[] => {
  if (totalIssues === 0) return []
  const allText = allIssueLines.map(l => shellEscape(l)).join(String.raw`\n`)
  return [
    '---',
    `Copy All Issues (${totalIssues}) | bash=/bin/bash param1=-c param2='echo "${allText}" | pbcopy' terminal=false`
  ]
}
const formatSwiftBar = async (allIssues: Map<string, Issue[]>): Promise<string> => {
  const paths = [...allIssues.keys()]
  const [repos, bunVer, uiSync] = await Promise.all([
    Promise.all(paths.map(async p => getGhRepo(p))),
    getBunVersion(),
    getUiSyncTime(paths)
  ])
  const repoMap = new Map(paths.map((p, i) => [p, repos[i]]))
  const maxName = Math.max(...paths.map(p => projectName(p).length))
  const menus = [...allIssues].map(([path, issues]) =>
    projectMenu({ issues, name: projectName(path).padEnd(maxName), path, repo: repoMap.get(path) })
  )
  return [
    ...swiftBarHeader({ allIssues, bunVer, uiSync }),
    ...menus.flatMap(m => m.lines),
    ...copyAllLines(
      menus.flatMap(m => m.issueLines),
      countRealIssues(allIssues)
    ),
    '---',
    'Refresh | refresh=true'
  ].join('\n')
}
export { formatIssues, formatSwiftBar, getUiSyncTime, hasRealIssues, shellEscape, timeAgo }
