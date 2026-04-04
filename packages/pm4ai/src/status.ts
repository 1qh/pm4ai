/* eslint-disable no-console */
import { $, file } from 'bun'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Issue } from './audit.js'
import { audit } from './audit.js'
import { EXPECTED, FORBIDDEN_LOCKFILES, MUST_EXIST_FILES, VERBATIM_FILES } from './constants.js'
import { discover } from './discover.js'
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
  else if (ciConclusion === 'success') issues.push({ detail: `passed ${ciTime ?? ''}`, type: 'info' })
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
  const names = VERBATIM_FILES
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
const checkRootPkg = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const pkgFile = file(join(projectPath, 'package.json'))
  if (!(await pkgFile.exists())) return issues
  const pkg = (await pkgFile.json()) as {
    packageManager?: string
    private?: boolean
    scripts?: Record<string, string>
    'simple-git-hooks'?: { 'pre-commit'?: string }
  }
  if (!pkg.private) issues.push({ detail: 'root package.json should be private', type: 'drift' })
  if (!pkg.packageManager) issues.push({ detail: 'packageManager field missing', type: 'missing' })
  if (!pkg['simple-git-hooks']) issues.push({ detail: 'simple-git-hooks in package.json', type: 'missing' })
  else if (pkg['simple-git-hooks']['pre-commit'] !== EXPECTED.preCommit)
    issues.push({ detail: 'pre-commit should be "sh up.sh && git add -u"', type: 'drift' })
  if (pkg.scripts?.prepare !== EXPECTED.prepare)
    issues.push({ detail: 'prepare should be "bunx simple-git-hooks"', type: 'drift' })
  if (!pkg.scripts?.postinstall?.includes('sherif'))
    issues.push({ detail: 'postinstall should include sherif', type: 'drift' })
  if (pkg.scripts?.clean && !pkg.scripts.clean.startsWith('sh clean.sh'))
    issues.push({ detail: 'clean should start with "sh clean.sh"', type: 'drift' })
  return issues
}
const checkConfigs = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const mustExist = MUST_EXIST_FILES
  for (const entry of mustExist) if (!existsSync(join(projectPath, entry))) issues.push({ detail: entry, type: 'missing' })
  const tsconfigFile = file(join(projectPath, 'tsconfig.json'))
  if (await tsconfigFile.exists()) {
    const tsconfig = (await tsconfigFile.json()) as { extends?: string }
    if (tsconfig.extends !== EXPECTED.tsconfigExtends)
      issues.push({ detail: 'tsconfig.json should extend lintmax/tsconfig', type: 'drift' })
  }
  const vercelFile = file(join(projectPath, 'vercel.json'))
  if (await vercelFile.exists()) {
    const vercel = (await vercelFile.json()) as { installCommand?: string }
    if (vercel.installCommand !== EXPECTED.vercelInstall)
      issues.push({ detail: 'vercel.json installCommand should be "bun i"', type: 'drift' })
  }
  return issues
}
const checkForbidden = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  for (const f of FORBIDDEN_LOCKFILES)
    if (existsSync(join(projectPath, f))) issues.push({ detail: `${f} found, use bun only`, type: 'forbidden' })
  const bunLockTracked = await $`git ls-files bun.lock`.cwd(projectPath).quiet().nothrow()
  if (bunLockTracked.stdout.toString().trim())
    issues.push({ detail: 'bun.lock tracked in git, should be gitignored', type: 'forbidden' })
  const nestedGitignores =
    await $`find ${projectPath} -name .gitignore -not -path '*/node_modules/*' -not -path '*/.git/*'`.quiet().nothrow()
  const extraGitignores = nestedGitignores.stdout
    .toString()
    .trim()
    .split('\n')
    .filter(f => f && f !== join(projectPath, '.gitignore'))
  if (extraGitignores.length > 0)
    issues.push({
      detail: `nested .gitignore: ${extraGitignores.map(f => f.replace(`${projectPath}/`, '')).join(', ')}`,
      type: 'drift'
    })
  const postcssFiles =
    await $`find ${projectPath} -name 'postcss.config.mjs' -not -path '*/node_modules/*' -not -path '*/readonly/*'`
      .quiet()
      .nothrow()
  if (postcssFiles.stdout.toString().trim()) issues.push({ detail: 'postcss.config.mjs should be .ts', type: 'drift' })
  const tsNoCheck =
    await $`rg '^// @ts-nocheck|^/\* @ts-nocheck' ${projectPath} -g '*.ts' -g '*.tsx' -g '!node_modules' -g '!readonly' -g '!.next' -l`
      .quiet()
      .nothrow()
  const tsNoCheckFiles = tsNoCheck.stdout.toString().trim()
  if (tsNoCheckFiles)
    issues.push({
      detail: `@ts-nocheck in: ${tsNoCheckFiles
        .split('\n')
        .map(f => f.replace(`${projectPath}/`, ''))
        .join(', ')}`,
      type: 'forbidden'
    })
  return issues
}
const hasRealIssues = (issues: Issue[]) => issues.some(i => i.type !== 'info')
const formatIssues = (projectPath: string, issues: Issue[]): string => {
  if (issues.length === 0) return ''
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
const getBunVer = async (): Promise<string> => {
  const r = await $`bun --version`.quiet().nothrow()
  return r.stdout.toString().trim()
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
    getBunVer(),
    getUiSyncTime(paths)
  ])
  const repoMap = new Map(paths.map((p, i) => [p, repos[i]]))
  const lines: string[] = []
  if (anyReal) lines.push(`${clean}/${total} | sfimage=xmark.circle.fill sfcolor=red`)
  else lines.push(`${total}/${total} | sfimage=checkmark.circle.fill sfcolor=green`)
  const f = '| font=Menlo size=13'
  lines.push('---')
  lines.push(`${total} projects  ${totalIssues} issues  bun ${bunVer}  ui ${uiSync} ${f}`)
  lines.push('---')
  const maxName = Math.max(...[...allIssues.keys()].map(p => (p.split('/').pop() ?? '').length))
  const allIssueLines: string[] = []
  for (const [path, issues] of allIssues) {
    const name = (path.split('/').pop() ?? '').padEnd(maxName)
    const repo = repoMap.get(path)
    const ghUrl = repo ? `https://github.com/${repo}` : ''
    const ciInfo = issues.find(i => i.type === 'info')
    const ciTime = (ciInfo ? timeAgo(ciInfo.detail.replace('passed ', '').replace('failed ', '')) : '').padEnd(6)
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
      const issueText = realIssues.map(i => i.detail).join(String.raw`\n`)
      lines.push(`--Copy Issues | bash=/bin/bash param1=-c param2='echo "${issueText}" | pbcopy' terminal=false`)
    }
  }
  if (totalIssues > 0) {
    lines.push('---')
    const allText = allIssueLines.join(String.raw`\n`)
    lines.push(
      `Copy All Issues (${totalIssues}) | bash=/bin/bash param1=-c param2='echo "${allText}" | pbcopy' terminal=false`
    )
  }
  lines.push('---')
  lines.push('Refresh | refresh=true')
  return lines.join('\n')
}
export const status = async (swiftbar = false) => {
  const { consumers, self } = await discover()
  const allIssues = new Map<string, Issue[]>()
  const allProjects = [self, ...consumers]
  const checks = allProjects.map(async project => {
    const issues: Issue[] = []
    const results = await Promise.all([
      checkGit(project.path),
      checkDrift(self.path, project.path),
      checkRootPkg(project.path),
      checkConfigs(project.path),
      checkForbidden(project.path),
      audit(project.path),
      checkCi(project.path)
    ])
    for (const r of results) issues.push(...r)
    allIssues.set(project.path, issues)
  })
  await Promise.all(checks)
  if (swiftbar) console.log(await formatSwiftBar(allIssues))
  else {
    for (const [path, issues] of allIssues) {
      const output = formatIssues(path, issues)
      if (output) {
        console.log(output)
        console.log()
      }
    }
    await $`open swiftbar://refreshplugin?name=pm4ai`.quiet().nothrow()
  }
}
