/* eslint-disable no-console */
import { $ } from 'bun'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Issue } from './types.js'
import { audit } from './audit.js'
import { writeCheckResult } from './check-cache.js'
import { READONLY_UI } from './constants.js'
import { discover, discoverSources } from './discover.js'
import { updateLog } from './log.js'
import { syncClaudeMd, syncConfigs, syncPackageJson, syncUi } from './sync.js'
import { isInsideProject, projectName } from './utils.js'
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
    try {
      const lock = JSON.parse(readFileSync(lockFile, 'utf8')) as { at: string; pid: number }
      const age = Date.now() - new Date(lock.at).getTime()
      const alive = (() => {
        try {
          process.kill(lock.pid, 0)
          return true
        } catch {
          return false
        }
      })()
      if (alive && age < 600_000) {
        console.log('another fix is already running')
        return
      }
    } catch {
      /* Stale lock */
    }
    rmSync(lockFile)
  }
  mkdirSync(join(homedir(), '.pm4ai'), { recursive: true })
  writeFileSync(lockFile, JSON.stringify({ at: new Date().toISOString(), pid: process.pid }))
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
    const blocked: string[] = []
    await Promise.all(
      consumers.map(async project => {
        const name = projectName(project.path)
        const dirty = await $`git status --porcelain`.cwd(project.path).quiet().nothrow()
        if (dirty.stdout.toString().trim() && !project.isCnsync) {
          blocked.push(`${name}: uncommitted changes`)
          return
        }
        await $`git fetch`.cwd(project.path).quiet().nothrow()
        const behind = await $`git rev-list --count HEAD..@{u}`.cwd(project.path).quiet().nothrow()
        const ahead = await $`git rev-list --count @{u}..HEAD`.cwd(project.path).quiet().nothrow()
        const b = Number.parseInt(behind.stdout.toString().trim(), 10)
        const a = Number.parseInt(ahead.stdout.toString().trim(), 10)
        if (b > 0 && a === 0) {
          await $`git pull`.cwd(project.path).quiet().nothrow()
          console.log(`${name}: pulled ${b} commits`)
        } else if (b > 0) blocked.push(`${name}: diverged (${b} behind, ${a} ahead)`)
        else if (a > 0) blocked.push(`${name}: ${a} commits ahead, push first`)
      })
    )
    if (blocked.length > 0) {
      console.log('fix requires clean git state:')
      for (const msg of blocked) console.log(`  ${msg}`)
      return
    }
    await Promise.all([gitPull(self.path), gitPull(cnsync.path)])
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
    console.log('--- changes ---')
    const summaries = await Promise.all(
      consumers.map(async project => {
        const diff = await $`git status --porcelain`.cwd(project.path).quiet().nothrow()
        const changed = diff.stdout.toString().trim()
        const count = changed ? changed.split('\n').length : 0
        return count > 0 ? `${projectName(project.path)}: ${count} files modified` : `${projectName(project.path)}: clean`
      })
    )
    for (const s of summaries) console.log(s)
    await $`open swiftbar://refreshplugin?name=pm4ai`.quiet().nothrow()
  } finally {
    rmSync(lockFile, { force: true })
  }
}
