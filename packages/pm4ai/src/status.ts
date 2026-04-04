/* eslint-disable no-console */
import { $, file } from 'bun'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Issue } from './audit.js'
import { audit } from './audit.js'
import { discover } from './discover.js'
import { readLog } from './log.js'
const ghRepoRe = /github\.com[/:](?<repo>[^/]+\/[^/.]+)/u
const getGhRepo = async (projectPath: string): Promise<string | undefined> => {
  const result = await $`git remote get-url origin`.cwd(projectPath).quiet().nothrow()
  const url = result.stdout.toString().trim()
  return ghRepoRe.exec(url)?.groups?.repo
}
const checkCi = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const repo = await getGhRepo(projectPath)
  if (!repo) return issues
  const ciResult =
    await $`gh run list --repo ${repo} --limit 1 --json conclusion,createdAt --jq '.[0] | "\(.conclusion) \(.createdAt)"'`
      .quiet()
      .nothrow()
  const ciLine = ciResult.stdout.toString().trim()
  const [ciConclusion, ciTime] = ciLine.split(' ')
  if (ciConclusion === 'failure') issues.push({ detail: `failed ${ciTime ?? ''}`, type: 'ci' })
  else if (ciConclusion === 'success') issues.push({ detail: `passed ${ciTime ?? ''}`, type: 'ci' })
  return issues
}
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
  const mustExist = ['turbo.json', 'tsconfig.json', '.github/workflows/ci.yml']
  for (const entry of mustExist) if (!existsSync(join(projectPath, entry))) issues.push({ detail: entry, type: 'missing' })
  const pkgFile = file(join(projectPath, 'package.json'))
  if (await pkgFile.exists()) {
    const pkg = (await pkgFile.json()) as {
      scripts?: Record<string, string>
      'simple-git-hooks'?: unknown
    }
    if (!pkg['simple-git-hooks']) issues.push({ detail: 'simple-git-hooks in package.json', type: 'missing' })
    if (!pkg.scripts?.prepare) issues.push({ detail: 'prepare script in package.json', type: 'missing' })
    if (pkg.scripts?.clean && !pkg.scripts.clean.startsWith('sh clean.sh'))
      issues.push({ detail: 'clean script should start with "sh clean.sh"', type: 'drift' })
  }
  const vercelFile = file(join(projectPath, 'vercel.json'))
  if (await vercelFile.exists()) {
    const vercel = (await vercelFile.json()) as { installCommand?: string }
    if (vercel.installCommand !== 'bun i')
      issues.push({ detail: 'vercel.json installCommand should be "bun i"', type: 'drift' })
  }
  const forbidden = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.npmrc', '.yarnrc', '.yarnrc.yml']
  for (const f of forbidden)
    if (existsSync(join(projectPath, f))) issues.push({ detail: `${f} found, use bun only`, type: 'forbidden' })
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
    const [gitIssues, driftIssues, existIssues, auditIssues, ciIssues] = await Promise.all([
      checkGit(project.path),
      checkDrift(self.path, project.path),
      checkExists(project.path),
      audit(project.path),
      checkCi(project.path)
    ])
    issues.push(...gitIssues, ...driftIssues, ...existIssues, ...auditIssues, ...ciIssues)
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
