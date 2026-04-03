/* eslint-disable no-console */
import { $ } from 'bun'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Issue } from './audit.js'
import { audit } from './audit.js'
import { discover } from './discover.js'
import { updateLog } from './log.js'
import { syncClaudeMd, syncConfigs, syncUi } from './sync.js'
const gitPull = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const statusResult = await $`git status --porcelain`.cwd(projectPath).quiet().nothrow()
  const statusOut = statusResult.stdout.toString().trim()
  if (statusOut) {
    issues.push({ detail: 'dirty, skipping pull', type: 'git' })
    return issues
  }
  await $`git fetch`.cwd(projectPath).quiet().nothrow()
  const behindResult = await $`git rev-list --count HEAD..@{u}`.cwd(projectPath).quiet().nothrow()
  const behind = Number.parseInt(behindResult.stdout.toString().trim(), 10)
  if (behind > 0) {
    await $`git pull`.cwd(projectPath).quiet().nothrow()
    issues.push({ detail: `pulled ${behind} commits`, type: 'git' })
  }
  return issues
}
const maintain = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const upSh = join(projectPath, 'up.sh')
  if (!existsSync(upSh)) {
    issues.push({ detail: 'missing, cannot maintain', type: 'up.sh' })
    return issues
  }
  const result = await $`sh up.sh`.cwd(projectPath).quiet().nothrow()
  const { exitCode } = result
  const stderr = result.stderr.toString().trim()
  if (exitCode === 0) {
    const snapshotDir = join(homedir(), '.pm4ai', 'snapshots', projectPath.split('/').pop() ?? 'unknown')
    const lockfile = join(projectPath, 'bun.lock')
    if (existsSync(lockfile)) {
      mkdirSync(snapshotDir, { recursive: true })
      copyFileSync(lockfile, join(snapshotDir, 'bun.lock'))
    }
  } else {
    const errorLine = stderr.split('\n').findLast(Boolean) ?? 'unknown error'
    issues.push({ detail: `failed: ${errorLine}`, type: 'up.sh' })
  }
  updateLog({
    at: new Date().toISOString(),
    error: exitCode === 0 ? undefined : stderr.slice(0, 500),
    pass: exitCode === 0,
    path: projectPath,
    project: projectPath.split('/').pop() ?? 'unknown'
  })
  return issues
}
export const fix = async () => {
  const { cnsync, consumers, self } = await discover()
  console.log(`found ${consumers.length} projects`)
  console.log()
  const allProjects = [self, cnsync, ...consumers.filter(c => !c.isCnsync)]
  const pullResults = await Promise.all(
    allProjects.map(async p => ({
      issues: await gitPull(p.path),
      name: p.name
    }))
  )
  for (const r of pullResults) for (const issue of r.issues) console.log(`${r.name}: ${issue.detail}`)
  const tasks = consumers.map(async project => {
    const issues: Issue[] = []
    const [configIssues, claudeIssues] = await Promise.all([
      syncConfigs(self.path, project.path),
      syncClaudeMd(self.path, project.path)
    ])
    issues.push(...configIssues, ...claudeIssues)
    if (existsSync(join(project.path, 'readonly'))) issues.push(...syncUi(cnsync.path, project.path))
    const auditIssues = await audit(project.path)
    issues.push(...auditIssues)
    const maintainIssues = await maintain(project.path)
    issues.push(...maintainIssues)
    if (issues.length > 0) {
      const lines = [project.path, ...issues.map(i => `  ${i.type} ${i.detail}`)]
      console.log(lines.join('\n'))
      console.log()
    }
  })
  await Promise.all(tasks)
}
