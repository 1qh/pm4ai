/* eslint-disable no-console */
import { $, file } from 'bun'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Issue } from './audit.js'
import { audit } from './audit.js'
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
  else if (pkg['simple-git-hooks']['pre-commit'] !== 'sh up.sh && git add -u')
    issues.push({ detail: 'pre-commit should be "sh up.sh && git add -u"', type: 'drift' })
  if (pkg.scripts?.prepare !== 'bunx simple-git-hooks')
    issues.push({ detail: 'prepare should be "bunx simple-git-hooks"', type: 'drift' })
  if (!pkg.scripts?.postinstall?.includes('sherif'))
    issues.push({ detail: 'postinstall should include sherif', type: 'drift' })
  if (pkg.scripts?.clean && !pkg.scripts.clean.startsWith('sh clean.sh'))
    issues.push({ detail: 'clean should start with "sh clean.sh"', type: 'drift' })
  return issues
}
const checkConfigs = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const mustExist = ['turbo.json', 'tsconfig.json', '.github/workflows/ci.yml']
  for (const entry of mustExist) if (!existsSync(join(projectPath, entry))) issues.push({ detail: entry, type: 'missing' })
  const tsconfigFile = file(join(projectPath, 'tsconfig.json'))
  if (await tsconfigFile.exists()) {
    const tsconfig = (await tsconfigFile.json()) as { extends?: string }
    if (tsconfig.extends !== 'lintmax/tsconfig')
      issues.push({ detail: 'tsconfig.json should extend lintmax/tsconfig', type: 'drift' })
  }
  const vercelFile = file(join(projectPath, 'vercel.json'))
  if (await vercelFile.exists()) {
    const vercel = (await vercelFile.json()) as { installCommand?: string }
    if (vercel.installCommand !== 'bun i')
      issues.push({ detail: 'vercel.json installCommand should be "bun i"', type: 'drift' })
  }
  return issues
}
const checkForbidden = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const lockfiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.npmrc', '.yarnrc', '.yarnrc.yml']
  for (const f of lockfiles)
    if (existsSync(join(projectPath, f))) issues.push({ detail: `${f} found, use bun only`, type: 'forbidden' })
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
    await $`rg '@ts-nocheck' ${projectPath} -g '*.ts' -g '*.tsx' -g '!node_modules' -g '!readonly' -g '!.next' -l`
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
  const allIssues = new Map<string, Issue[]>()
  const checks = consumers.map(async project => {
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
