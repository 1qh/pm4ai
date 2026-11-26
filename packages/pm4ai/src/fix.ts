/* eslint-disable no-console */
import { $, file, spawn } from 'bun'
import { copyFile, mkdir, open, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Project } from './discover.js'
import type { Issue } from './types.js'
import { audit } from './audit.js'
import { writeCheckResult } from './check-cache.js'
import { READONLY_UI } from './constants.js'
import { boundedRg, discover, discoverSources } from './discover.js'
import { updateLog } from './log.js'
import { lockSchema, safeParseJson } from './schemas.js'
import { stateDir, statePath } from './state-dir.js'
import {
  canonicalizeClaudeMd,
  syncClaudeMd,
  syncConfigs,
  syncFumadocsBuild,
  syncFumadocsGithubUrl,
  syncPackageJson,
  syncSubPackages,
  syncTsconfig,
  syncUi
} from './sync.js'
import { isNestedInRepo, projectName, projectRootOf } from './utils.js'
import { emitToSocket } from './watch-emitter.js'
import { createEvent } from './watch-types.js'
const isDirectory = async (p: string): Promise<boolean> => {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}
const hasHandwrittenTsx = async (projectPath: string): Promise<boolean> => {
  const ignoreUi = `!${READONLY_UI}/**`
  const out = await boundedRg(['--files', '-g', '*.tsx', '-g', ignoreUi], projectPath)
  return out.length > 0
}
const DOCS_ONLY_RE = /(?:^|\/)(?:CLAUDE|AGENTS)\.md$|(?:^|\/)\.github\/workflows\//u
const changedPaths = (porcelain: string): string[] =>
  porcelain
    .split('\n')
    .filter(Boolean)
    .map(line => line.slice(3).trim())
/** A sync that changed only generated docs (CLAUDE.md, AGENTS.md) or CI workflows cannot affect build/lint/test, so `up.sh` would verify unchanged code. Skip the gate for such a sync; any source, package.json, tsconfig, or vendored-ui change still runs it. Returns false on an empty change set so a zero-diff sync is not mistaken for docs-only. */
const isDocsOnlyChange = (porcelain: string): boolean => {
  const paths = changedPaths(porcelain)
  return paths.length > 0 && paths.every(p => DOCS_ONLY_RE.test(p))
}
const violationRe = /(?<!\d)(?<count>\d+)\s*(?:error|violation|problem|issue)/iu
const snapshotLockfile = async (projectPath: string) => {
  const snapshotDir = statePath('snapshots', projectName(projectPath))
  const lockfile = join(projectPath, 'bun.lock')
  const lockfileExists = await file(lockfile).exists()
  if (!lockfileExists) return
  await mkdir(snapshotDir, { recursive: true })
  await copyFile(lockfile, join(snapshotDir, 'bun.lock'))
}
const recordSuccess = async (projectPath: string): Promise<Issue[]> => {
  await snapshotLockfile(projectPath)
  await writeCheckResult({ pass: true, projectPath, violations: 0 })
  return []
}
const recordFailure = async (projectPath: string, stderr: string): Promise<Issue[]> => {
  const errorLine = stderr.split('\n').findLast(Boolean) ?? 'unknown error'
  const violationMatch = violationRe.exec(stderr)
  const violations = violationMatch?.groups?.count ? Math.trunc(Number(violationMatch.groups.count)) : 1
  await writeCheckResult({ pass: false, projectPath, summary: errorLine, violations })
  return [{ detail: `failed: ${errorLine}`, type: 'up.sh' }]
}
const runUpSh = async (projectPath: string) => {
  const proc = spawn(['sh', 'up.sh'], { cwd: projectPath, stderr: 'pipe', stdout: 'pipe', timeout: 600_000 })
  const [exitCode, stdout, outputError] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ])
  const stderr = [stdout, outputError].join('\n').trim()
  return { exitCode, stderr }
}
const canonicalizeMaintainedGuide = async (projectPath: string, selfPath?: string): Promise<Issue[]> => {
  if (selfPath === undefined) return []
  const canonicalizeError = await canonicalizeClaudeMd(projectPath, selfPath)
  return canonicalizeError === undefined ? [] : [{ detail: canonicalizeError, type: 'error' }]
}
const maintain = async (projectPath: string, selfPath?: string): Promise<Issue[]> => {
  const upShExists = await file(join(projectPath, 'up.sh')).exists()
  if (!upShExists) return [{ detail: 'missing, cannot maintain', type: 'up.sh' }]
  const { exitCode, stderr } = await runUpSh(projectPath)
  const issues = exitCode === 0 ? await recordSuccess(projectPath) : await recordFailure(projectPath, stderr)
  issues.push(...(await canonicalizeMaintainedGuide(projectPath, selfPath)))
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
const syncSelf = async (selfPath: string) => {
  logIssues(await syncSubPackages(selfPath, selfPath))
  const issues = await syncClaudeMd(selfPath, selfPath, true)
  logIssues(issues)
  if (issues.some(i => i.type === 'synced')) {
    const maintainIssues = await maintain(selfPath, selfPath)
    logIssues(maintainIssues)
    if (maintainIssues.length > 0) process.exitCode = 1
  }
}
const refuse = (message: string) => {
  console.log(message)
  process.exitCode = 1
}
const didAcquireLock = async (lockFile: string, lockData: string): Promise<boolean> => {
  try {
    const fd = await open(lockFile, 'wx')
    await fd.writeFile(lockData)
    await fd.close()
    return true
  } catch {
    return false
  }
}
const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const lockRefusal = async (lockFile: string): Promise<string | undefined> => {
  try {
    const lock = safeParseJson(lockSchema, await file(lockFile).text())
    if (!lock) return 'fix.lock is unreadable, so another run cannot be ruled out'
    const age = Date.now() - new Date(lock.at).getTime()
    if (isProcessAlive(lock.pid) && age < 600_000) return 'another fix is already running'
  } catch {
    /* Corrupt lock */
  }
}
const acquireFixLock = async (lockFile: string): Promise<string | undefined> => {
  const lockData = JSON.stringify({ at: new Date().toISOString(), pid: process.pid })
  if (await didAcquireLock(lockFile, lockData)) return
  const refusal = await lockRefusal(lockFile)
  if (refusal) return refusal
  await rm(lockFile, { force: true })
  if (!(await didAcquireLock(lockFile, lockData))) return 'another fix is already running'
}
interface FixTargets {
  cnsync: Project
  consumers: Project[]
  self: Project
}
const resolveFixTargets = async (shouldIncludeAll: boolean, excludes: readonly string[]): Promise<FixTargets> => {
  if (shouldIncludeAll) return discover(undefined, excludes)
  const projectPath = await projectRootOf()
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
type RepoState = { behind: number; name: string; path: string } | { name: string; reason: string }
const upstreamCounts = async (path: string): Promise<{ ahead: number; behind: number }> => {
  await $`git fetch`.cwd(path).quiet().nothrow()
  const behind = await $`git rev-list --count HEAD..@{u}`.cwd(path).quiet().nothrow()
  const ahead = await $`git rev-list --count @{u}..HEAD`.cwd(path).quiet().nothrow()
  return {
    ahead: Math.trunc(Number(ahead.stdout.toString().trim())),
    behind: Math.trunc(Number(behind.stdout.toString().trim()))
  }
}
const repoState = async (path: string): Promise<RepoState> => {
  const name = projectName(path)
  const status = await $`git status --porcelain -- .`.cwd(path).quiet().nothrow()
  if (status.stdout.toString().trim()) return { name, reason: 'uncommitted changes' }
  if (await isNestedInRepo(path))
    return { name, reason: 'not a repository root; skipped fetch and upstream ahead/behind counts' }
  const { ahead: a, behind: b } = await upstreamCounts(path)
  if (b > 0 && a > 0) return { name, reason: `diverged (${b} behind, ${a} ahead)` }
  if (a > 0) return { name, reason: `${a} commits ahead, push first` }
  return { behind: b, name, path }
}
const printBlocked = (blocked: string[]) => {
  console.log('fix requires clean git state:')
  for (const msg of blocked) console.log(`  ${msg}`)
  process.exitCode = 1
}
const pullRepos = async (states: RepoState[]) => {
  const pullable = states.flatMap(r => ('reason' in r || r.behind <= 0 ? [] : [{ name: r.name, path: r.path }]))
  await Promise.all(
    pullable.map(async repo => {
      await $`git pull`.cwd(repo.path).quiet().nothrow()
      console.log(`${repo.name}: pulled`)
    })
  )
}
const didPrepareRepos = async ({ cnsync, consumers, self }: FixTargets): Promise<boolean> => {
  console.log(`found ${consumers.length} projects`)
  console.log()
  const allRepos = [...new Map([self, cnsync, ...consumers].map(r => [r.path, r])).values()]
  const states = await Promise.all(allRepos.map(async repo => repoState(repo.path)))
  const blocked = states.flatMap(r => ('reason' in r ? [`${r.name}: ${r.reason}`] : []))
  if (blocked.length > 0) {
    printBlocked(blocked)
    return false
  }
  await pullRepos(states)
  return true
}
const modifiedCount = async (path: string): Promise<number> => {
  const diff = await $`git status --porcelain -- .`.cwd(path).quiet().nothrow()
  const changed = diff.stdout.toString().trim()
  return changed ? changed.split('\n').length : 0
}
const syncProject = async (project: Project, selfPath: string, cnsyncPath: string): Promise<Issue[]> => {
  const name = projectName(project.path)
  await emitToSocket(createEvent({ project: name, status: 'start', step: 'sync' }))
  const parallelIssues = await Promise.all([
    syncConfigs(selfPath, project.path),
    syncClaudeMd(selfPath, project.path, true),
    syncPackageJson(project.path, selfPath),
    syncTsconfig(project.path),
    syncFumadocsBuild(project.path),
    syncFumadocsGithubUrl(project.path)
  ])
  const issues: Issue[] = [...parallelIssues.flat(), ...(await syncSubPackages(selfPath, project.path))]
  const hasReadonlyUi = await isDirectory(join(project.path, READONLY_UI))
  if (hasReadonlyUi || (await hasHandwrittenTsx(project.path))) issues.push(...(await syncUi(cnsyncPath, project.path)))
  const syncCount = issues.filter(i => i.type === 'synced').length
  await emitToSocket(
    createEvent({ detail: syncCount > 0 ? `${syncCount} synced` : undefined, project: name, status: 'ok', step: 'sync' })
  )
  return issues
}
const auditProject = async (name: string, projectPath: string): Promise<Issue[]> => {
  await emitToSocket(createEvent({ project: name, status: 'start', step: 'audit' }))
  const auditIssues = await audit(projectPath)
  await emitToSocket(
    createEvent({
      detail: auditIssues.length > 0 ? `${auditIssues.length} issues` : undefined,
      project: name,
      status: auditIssues.length > 0 ? 'fail' : 'ok',
      step: 'audit'
    })
  )
  return auditIssues
}
const maintainProject = async (name: string, projectPath: string, selfPath?: string): Promise<Issue[]> => {
  await emitToSocket(createEvent({ project: name, status: 'start', step: 'maintain' }))
  const preMaintain = await $`git status --porcelain -- .`.cwd(projectPath).quiet().nothrow()
  const isDocsOnly = isDocsOnlyChange(preMaintain.stdout.toString().trim())
  if (isDocsOnly && selfPath === undefined) {
    await emitToSocket(createEvent({ detail: 'docs-only, gate skipped', project: name, status: 'ok', step: 'maintain' }))
    return []
  }
  const maintainIssues = await maintain(projectPath, selfPath)
  await emitToSocket(
    createEvent({
      detail: maintainIssues[0]?.detail,
      project: name,
      status: maintainIssues.length > 0 ? 'fail' : 'ok',
      step: 'maintain'
    })
  )
  return maintainIssues
}
const runProject = async (project: Project, selfPath: string, cnsyncPath: string): Promise<Issue[]> => {
  const name = projectName(project.path)
  const syncIssues = await syncProject(project, selfPath, cnsyncPath)
  const didRegenerateGuide = syncIssues.some(i => i.type === 'synced' && i.detail === 'CLAUDE.md updated')
  const issues = [
    ...syncIssues,
    ...(await auditProject(name, project.path)),
    ...(await maintainProject(name, project.path, didRegenerateGuide ? selfPath : undefined))
  ]
  const fileCount = await modifiedCount(project.path)
  await emitToSocket(
    createEvent({
      detail: fileCount > 0 ? `${fileCount} files modified` : 'clean',
      project: name,
      status: 'ok',
      step: 'done'
    })
  )
  if (issues.length > 0) {
    console.log([project.path, ...issues.map(i => `  ${i.type} ${i.detail}`)].join('\n'))
    console.log()
  }
  return issues
}
const reportChanges = async (allTargets: Project[]) => {
  console.log('--- changes ---')
  const summaries = await Promise.all(
    allTargets.map(async project => {
      const count = await modifiedCount(project.path)
      return count > 0 ? `${projectName(project.path)}: ${count} files modified` : `${projectName(project.path)}: clean`
    })
  )
  for (const s of summaries) console.log(s)
  if (process.platform === 'darwin') await $`open swiftbar://refreshplugin?name=pm4ai`.quiet().nothrow()
}
const runFix = async (shouldIncludeAll: boolean, excludes: readonly string[]) => {
  const targets = await resolveFixTargets(shouldIncludeAll, excludes)
  if (!(await didPrepareRepos(targets))) return
  const { cnsync, consumers, self } = targets
  await syncSelf(self.path)
  const allTargets = [cnsync, ...consumers]
  const allIssues = (
    await Promise.all(allTargets.map(async project => runProject(project, self.path, cnsync.path)))
  ).flat()
  const findings = allIssues.filter(i => i.type !== 'synced' && i.type !== 'info')
  if (findings.length > 0) process.exitCode = 1
  await reportChanges(allTargets)
}
const fix = async (shouldIncludeAll = false, excludes: readonly string[] = []) => {
  const lockFile = statePath('fix.lock')
  await mkdir(stateDir(), { recursive: true })
  const refusal = await acquireFixLock(lockFile)
  if (refusal) {
    refuse(refusal)
    return
  }
  try {
    await runFix(shouldIncludeAll, excludes)
  } finally {
    await rm(lockFile, { force: true })
  }
}
export { fix, isDocsOnlyChange, maintain }
