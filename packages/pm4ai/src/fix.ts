/* eslint-disable no-console */
import { $ } from 'bun'
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Issue } from './types.js'
import { audit } from './audit.js'
import { writeCheckResult } from './check-cache.js'
import { CONFIG_DIR, READONLY_UI } from './constants.js'
import { discover, discoverSources } from './discover.js'
import { updateLog } from './log.js'
import { lockSchema, safeParseJson } from './schemas.js'
import { syncClaudeMd, syncConfigs, syncPackageJson, syncSubPackages, syncTsconfig, syncUi } from './sync.js'
import { isInsideProject, projectName } from './utils.js'
import { emitToSocket } from './watch-emitter.js'
import { createEvent } from './watch-types.js'
const violationRe = /(?<count>\d+)\s*(?:error|violation|problem|issue)/iu
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
    const snapshotDir = join(homedir(), CONFIG_DIR, 'snapshots', projectName(projectPath))
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
export { maintain }
export const fix = async (all = false) => {
  const lockFile = join(homedir(), CONFIG_DIR, 'fix.lock')
  mkdirSync(join(homedir(), CONFIG_DIR), { recursive: true })
  const lockData = JSON.stringify({ at: new Date().toISOString(), pid: process.pid })
  const tryAcquireLock = (): boolean => {
    try {
      const fd = openSync(lockFile, 'wx')
      writeFileSync(fd, lockData)
      closeSync(fd)
      return true
    } catch {
      return false
    }
  }
  if (!tryAcquireLock()) {
    try {
      const lock = safeParseJson(lockSchema, readFileSync(lockFile, 'utf8'))
      if (!lock) return
      const age = Date.now() - new Date(lock.at).getTime()
      let alive = false
      try {
        process.kill(lock.pid, 0)
        alive = true
      } catch {
        /* Process not found */
      }
      if (alive && age < 600_000) {
        console.log('another fix is already running')
        return
      }
    } catch {
      /* Corrupt lock */
    }
    rmSync(lockFile, { force: true })
    if (!tryAcquireLock()) {
      console.log('another fix is already running')
      return
    }
  }
  try {
    const resolveTargets = async () => {
      if (all) return discover()
      const projectPath = await isInsideProject()
      if (projectPath) {
        const { self, cnsync } = await discoverSources()
        return {
          cnsync,
          consumers: [{ isCnsync: false, isSelf: false, name: projectName(projectPath), path: projectPath }],
          self
        }
      }
      return discover()
    }
    const { cnsync, consumers, self } = await resolveTargets()
    console.log(`found ${consumers.length} projects`)
    console.log()
    const allRepos = [self, cnsync, ...consumers]
    const blocked: string[] = []
    const pullable: { name: string; path: string }[] = []
    const checkResults = await Promise.all(
      allRepos.map(async repo => {
        const name = projectName(repo.path)
        const dirty = await $`git status --porcelain`.cwd(repo.path).quiet().nothrow()
        if (dirty.stdout.toString().trim()) return { name, reason: 'uncommitted changes' }
        await $`git fetch`.cwd(repo.path).quiet().nothrow()
        const behind = await $`git rev-list --count HEAD..@{u}`.cwd(repo.path).quiet().nothrow()
        const ahead = await $`git rev-list --count @{u}..HEAD`.cwd(repo.path).quiet().nothrow()
        const b = Number.parseInt(behind.stdout.toString().trim(), 10)
        const a = Number.parseInt(ahead.stdout.toString().trim(), 10)
        if (b > 0 && a > 0) return { name, reason: `diverged (${b} behind, ${a} ahead)` }
        if (a > 0) return { name, reason: `${a} commits ahead, push first` }
        return { behind: b, name, path: repo.path }
      })
    )
    for (const r of checkResults)
      if ('reason' in r) blocked.push(`${r.name}: ${r.reason}`)
      else if (r.behind > 0) pullable.push({ name: r.name, path: r.path })
    if (blocked.length > 0) {
      console.log('fix requires clean git state:')
      for (const msg of blocked) console.log(`  ${msg}`)
      return
    }
    await Promise.all(
      pullable.map(async repo => {
        await $`git pull`.cwd(repo.path).quiet().nothrow()
        console.log(`${repo.name}: pulled`)
      })
    )
    const selfSubPkgIssues = await syncSubPackages(self.path, self.path)
    if (selfSubPkgIssues.length > 0) for (const i of selfSubPkgIssues) console.log(`  ${i.type} ${i.detail}`)
    const allTargets = [cnsync, ...consumers]
    const tasks = allTargets.map(async project => {
      const name = projectName(project.path)
      const issues: Issue[] = []
      emitToSocket(createEvent({ project: name, status: 'start', step: 'sync' }))
      const [configIssues, claudeIssues, pkgIssues, tsconfigIssues] = await Promise.all([
        syncConfigs(self.path, project.path),
        syncClaudeMd(self.path, project.path),
        syncPackageJson(project.path, self.path),
        syncTsconfig(project.path)
      ])
      const subPkgIssues = await syncSubPackages(self.path, project.path)
      issues.push(...configIssues, ...claudeIssues, ...pkgIssues, ...tsconfigIssues, ...subPkgIssues)
      if (existsSync(join(project.path, READONLY_UI))) issues.push(...syncUi(cnsync.path, project.path))
      const syncCount = issues.filter(i => i.type === 'synced').length
      emitToSocket(
        createEvent({
          detail: syncCount > 0 ? `${syncCount} synced` : undefined,
          project: name,
          status: 'ok',
          step: 'sync'
        })
      )
      emitToSocket(createEvent({ project: name, status: 'start', step: 'audit' }))
      const auditIssues = await audit(project.path)
      issues.push(...auditIssues)
      emitToSocket(
        createEvent({
          detail: auditIssues.length > 0 ? `${auditIssues.length} issues` : undefined,
          project: name,
          status: auditIssues.length > 0 ? 'fail' : 'ok',
          step: 'audit'
        })
      )
      emitToSocket(createEvent({ project: name, status: 'start', step: 'maintain' }))
      const maintainIssues = await maintain(project.path)
      issues.push(...maintainIssues)
      const maintainDetail = maintainIssues[0]?.detail
      emitToSocket(
        createEvent({
          detail: maintainDetail,
          project: name,
          status: maintainIssues.length > 0 ? 'fail' : 'ok',
          step: 'maintain'
        })
      )
      const diff = await $`git status --porcelain`.cwd(project.path).quiet().nothrow()
      const changed = diff.stdout.toString().trim()
      const fileCount = changed ? changed.split('\n').length : 0
      emitToSocket(
        createEvent({
          detail: fileCount > 0 ? `${fileCount} files modified` : 'clean',
          project: name,
          status: 'ok',
          step: 'done'
        })
      )
      if (issues.length > 0) {
        const lines = [project.path, ...issues.map(i => `  ${i.type} ${i.detail}`)]
        console.log(lines.join('\n'))
        console.log()
      }
    })
    await Promise.all(tasks)
    console.log('--- changes ---')
    const summaries = await Promise.all(
      allTargets.map(async project => {
        const diff = await $`git status --porcelain`.cwd(project.path).quiet().nothrow()
        const changed = diff.stdout.toString().trim()
        const count = changed ? changed.split('\n').length : 0
        return count > 0 ? `${projectName(project.path)}: ${count} files modified` : `${projectName(project.path)}: clean`
      })
    )
    for (const s of summaries) console.log(s)
    if (process.platform === 'darwin') await $`open swiftbar://refreshplugin?name=pm4ai`.quiet().nothrow()
  } finally {
    rmSync(lockFile, { force: true })
  }
}
