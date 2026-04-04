/* eslint-disable no-console */
import { $ } from 'bun'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Issue } from './types.js'
import { audit } from './audit.js'
import { writeCheckResult } from './check-cache.js'
import { READONLY_UI } from './constants.js'
import { discover, discoverSources } from './discover.js'
import { updateLog } from './log.js'
import { syncClaudeMd, syncConfigs, syncPackageJson, syncUi } from './sync.js'
import { debug, isInsideProject, projectName } from './utils.js'
const violationRe = /(?<count>\d+)\s*(?:error|violation|problem|issue)/iu
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
    const snapshotDir = join(homedir(), '.pm4ai', 'snapshots', projectName(projectPath))
    const lockfile = join(projectPath, 'bun.lock')
    if (existsSync(lockfile)) {
      mkdirSync(snapshotDir, { recursive: true })
      copyFileSync(lockfile, join(snapshotDir, 'bun.lock'))
    }
    writeCheckResult({ pass: true, projectPath, violations: 0 })
  } else {
    const errorLine = stderr.split('\n').findLast(Boolean) ?? 'unknown error'
    issues.push({ detail: `failed: ${errorLine}`, type: 'up.sh' })
    const violationMatch = violationRe.exec(stderr)
    const violations = violationMatch?.groups?.count ? Number.parseInt(violationMatch.groups.count, 10) : 1
    writeCheckResult({ pass: false, projectPath, summary: errorLine, violations })
  }
  updateLog({
    at: new Date().toISOString(),
    error: exitCode === 0 ? undefined : stderr.slice(0, 500),
    pass: exitCode === 0,
    path: projectPath,
    project: projectName(projectPath)
  })
  return issues
}
export const fix = async (all = false) => {
  const lockFile = join(homedir(), '.pm4ai', 'fix.lock')
  if (existsSync(lockFile)) {
    debug('fix already running')
    console.log('another fix is already running')
    return
  }
  mkdirSync(join(homedir(), '.pm4ai'), { recursive: true })
  writeFileSync(lockFile, `${process.pid}`)
  try {
    const resolveTargets = async () => {
      if (all) return discover()
      const projectPath = await isInsideProject()
      if (projectPath) {
        const { self, cnsync } = await discoverSources()
        return {
          cnsync,
          consumers: [{ isCnsync: false, isSelf: false, name: projectPath.split('/').pop() ?? '', path: projectPath }],
          self
        }
      }
      return discover()
    }
    const { cnsync, consumers, self } = await resolveTargets()
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
      const [configIssues, claudeIssues, pkgIssues] = await Promise.all([
        syncConfigs(self.path, project.path),
        syncClaudeMd(self.path, project.path),
        syncPackageJson(project.path)
      ])
      issues.push(...configIssues, ...claudeIssues, ...pkgIssues)
      if (existsSync(join(project.path, READONLY_UI))) issues.push(...syncUi(cnsync.path, project.path))
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
    await $`open swiftbar://refreshplugin?name=pm4ai`.quiet().nothrow()
  } finally {
    rmSync(lockFile, { force: true })
  }
}
