/* eslint-disable no-console */
import { $, file } from 'bun'
import { copyFile, mkdir, open, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Issue } from './types.js'
import { audit } from './audit.js'
import { writeCheckResult } from './check-cache.js'
import { READONLY_UI } from './constants.js'
import { discover, discoverSources } from './discover.js'
import { updateLog } from './log.js'
import { lockSchema, safeParseJson } from './schemas.js'
import { stateDir, statePath } from './state-dir.js'
import {
  syncClaudeMd,
  syncConfigs,
  syncFumadocsBuild,
  syncFumadocsGithubUrl,
  syncPackageJson,
  syncSubPackages,
  syncTsconfig,
  syncUi
} from './sync.js'
import { isInsideProject, projectName } from './utils.js'
import { emitToSocket } from './watch-emitter.js'
import { createEvent } from './watch-types.js'

const dirExists = async (p: string): Promise<boolean> => {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}
const hasHandwrittenTsx = async (projectPath: string): Promise<boolean> => {
  const r = await $`rg --files -g ${'*.tsx'} -g ${`!${READONLY_UI}/**`}`.cwd(projectPath).quiet().nothrow()
  return r.stdout.toString().trim().length > 0
}
const violationRe = /(?<count>\d+)\s*(?:error|violation|problem|issue)/iu
const maintain = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const upSh = join(projectPath, 'up.sh')
  const upShExists = await file(upSh).exists()
  if (!upShExists) {
    issues.push({ detail: 'missing, cannot maintain', type: 'up.sh' })
    return issues
  }
  const result = await $`sh up.sh`.cwd(projectPath).quiet().nothrow()
  const { exitCode } = result
  const stderr = [result.stdout.toString(), result.stderr.toString()].join('\n').trim()
  if (exitCode === 0) {
    const snapshotDir = statePath('snapshots', projectName(projectPath))
    const lockfile = join(projectPath, 'bun.lock')
    const lockfileExists = await file(lockfile).exists()
    if (lockfileExists) {
      await mkdir(snapshotDir, { recursive: true })
      await copyFile(lockfile, join(snapshotDir, 'bun.lock'))
    }
    await writeCheckResult({ pass: true, projectPath, violations: 0 })
  } else {
    const errorLine = stderr.split('\n').findLast(Boolean) ?? 'unknown error'
    issues.push({ detail: `failed: ${errorLine}`, type: 'up.sh' })
    const violationMatch = violationRe.exec(stderr)
    const violations = violationMatch?.groups?.count ? Math.trunc(Number(violationMatch.groups.count)) : 1
    await writeCheckResult({ pass: false, projectPath, summary: errorLine, violations })
  }
  await updateLog({
    at: new Date().toISOString(),
    error: exitCode === 0 ? undefined : stderr.slice(0, 500),
    pass: exitCode === 0,
    path: projectPath,
    project: projectName(projectPath)
  })
  return issues
}
const logIssues = (issues: Issue[]): void => {
  for (const i of issues) console.log(`  ${i.type} ${i.detail}`)
}
/** pm4ai syncs itself too — its sub-packages and its own CLAUDE.md, generated from the same .mdx it ships to everyone, so the manager's own guidance never rots against its source. */
const syncSelf = async (selfPath: string): Promise<void> => {
  logIssues(await syncSubPackages(selfPath, selfPath))
  logIssues(await syncClaudeMd(selfPath, selfPath))
}
export { maintain }
export const fix = async (all = false, excludes: readonly string[] = []) => {
  const lockFile = statePath('fix.lock')
  await mkdir(stateDir(), { recursive: true })
  const lockData = JSON.stringify({ at: new Date().toISOString(), pid: process.pid })
  const tryAcquireLock = async (): Promise<boolean> => {
    try {
      const fd = await open(lockFile, 'wx')
      await fd.writeFile(lockData)
      await fd.close()
      return true
    } catch {
      return false
    }
  }
  if (!(await tryAcquireLock())) {
    try {
      const lock = safeParseJson(lockSchema, await file(lockFile).text())
      if (!lock) {
        console.log('fix.lock is unreadable, so another run cannot be ruled out')
        process.exitCode = 1
        return
      }
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
        process.exitCode = 1
        return
      }
    } catch {
      /* Corrupt lock */
    }
    await rm(lockFile, { force: true })
    if (!(await tryAcquireLock())) {
      console.log('another fix is already running')
      process.exitCode = 1
      return
    }
  }
  try {
    const resolveTargets = async () => {
      if (all) return discover(undefined, excludes)
      const projectPath = await isInsideProject()
      if (projectPath) {
        const { self, cnsync } = await discoverSources()
        return {
          cnsync,
          consumers: [{ isCnsync: false, isSelf: false, name: projectName(projectPath), path: projectPath }],
          self
        }
      }
      return discover(undefined, excludes)
    }
    const { cnsync, consumers, self } = await resolveTargets()
    console.log(`found ${consumers.length} projects`)
    console.log()
    const allRepos = [...new Map([self, cnsync, ...consumers].map(r => [r.path, r])).values()]
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
        const b = Math.trunc(Number(behind.stdout.toString().trim()))
        const a = Math.trunc(Number(ahead.stdout.toString().trim()))
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
      process.exitCode = 1
      return
    }
    await Promise.all(
      pullable.map(async repo => {
        await $`git pull`.cwd(repo.path).quiet().nothrow()
        console.log(`${repo.name}: pulled`)
      })
    )
    await syncSelf(self.path)
    const allTargets = [cnsync, ...consumers]
    const tasks = allTargets.map(async project => {
      const name = projectName(project.path)
      const issues: Issue[] = []
      await emitToSocket(createEvent({ project: name, status: 'start', step: 'sync' }))
      const [configIssues, claudeIssues, pkgIssues, tsconfigIssues, fumadocsBuildIssues, fumadocsGithubIssues] =
        await Promise.all([
          syncConfigs(self.path, project.path),
          syncClaudeMd(self.path, project.path),
          syncPackageJson(project.path, self.path),
          syncTsconfig(project.path),
          syncFumadocsBuild(project.path),
          syncFumadocsGithubUrl(project.path)
        ])
      const subPkgIssues = await syncSubPackages(self.path, project.path)
      issues.push(
        ...configIssues,
        ...claudeIssues,
        ...pkgIssues,
        ...tsconfigIssues,
        ...fumadocsBuildIssues,
        ...fumadocsGithubIssues,
        ...subPkgIssues
      )
      const hasReadonlyUi = await dirExists(join(project.path, READONLY_UI))
      if (hasReadonlyUi || (await hasHandwrittenTsx(project.path)))
        issues.push(...(await syncUi(cnsync.path, project.path)))
      const syncCount = issues.filter(i => i.type === 'synced').length
      await emitToSocket(
        createEvent({
          detail: syncCount > 0 ? `${syncCount} synced` : undefined,
          project: name,
          status: 'ok',
          step: 'sync'
        })
      )
      await emitToSocket(createEvent({ project: name, status: 'start', step: 'audit' }))
      const auditIssues = await audit(project.path)
      issues.push(...auditIssues)
      await emitToSocket(
        createEvent({
          detail: auditIssues.length > 0 ? `${auditIssues.length} issues` : undefined,
          project: name,
          status: auditIssues.length > 0 ? 'fail' : 'ok',
          step: 'audit'
        })
      )
      await emitToSocket(createEvent({ project: name, status: 'start', step: 'maintain' }))
      const maintainIssues = await maintain(project.path)
      issues.push(...maintainIssues)
      const maintainDetail = maintainIssues[0]?.detail
      await emitToSocket(
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
      await emitToSocket(
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
      return issues
    })
    const allIssues = (await Promise.all(tasks)).flat()
    const findings = allIssues.filter(i => i.type !== 'synced' && i.type !== 'info')
    if (findings.length > 0) process.exitCode = 1
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
    await rm(lockFile, { force: true })
  }
}
