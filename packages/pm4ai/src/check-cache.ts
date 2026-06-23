/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: intentional catch-swallow */
/* eslint-disable no-empty */
import { $, file, spawn, write } from 'bun'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CLAUDE_MD, CONFIG_DIR, VERBATIM_FILES } from './constants.js'
import { checkResultSchema, lockSchema, safeParseJson } from './schemas.js'

interface CheckResult {
  at: string
  commit: string
  pass: boolean
  summary?: string
  violations: number
}
const checksDir = () => join(homedir(), CONFIG_DIR, 'checks')
const leadingSepRe = /^--/u
const safeFileName = (projectPath: string) => projectPath.replaceAll('/', '--').replace(leadingSepRe, '')
const cachePath = (projectPath: string) => join(checksDir(), `${safeFileName(projectPath)}.json`)
const lockPath = (projectPath: string) => join(checksDir(), `${safeFileName(projectPath)}.lock`)
const readCheckResult = async (projectPath: string): Promise<CheckResult | undefined> => {
  const p = cachePath(projectPath)
  const pExists = await file(p).exists()
  if (!pExists) return
  try {
    return safeParseJson(checkResultSchema, await file(p).text())
  } catch {}
}
const readCheckResultBlocking = (projectPath: string): CheckResult | undefined => {
  const p = cachePath(projectPath)
  // oxlint-disable-next-line node/no-sync -- synchronous Ink reducer init/reset cannot await
  if (!existsSync(p)) return
  try {
    // oxlint-disable-next-line node/no-sync -- synchronous Ink reducer init/reset cannot await
    return safeParseJson(checkResultSchema, readFileSync(p, 'utf8'))
  } catch {}
}
const getHeadCommit = async (projectPath: string): Promise<string> => {
  const r = await $`git rev-parse HEAD`.cwd(projectPath).quiet().nothrow()
  if (r.exitCode === 0) return r.stdout.toString().trim()
  return ''
}
const getCodeCommitsSince = async (projectPath: string, commit: string): Promise<number> => {
  if (!commit) return -1
  const excludes = [CLAUDE_MD, '*.md', ...VERBATIM_FILES].map(f => `:!${f}`)
  const r = await $`git rev-list --count ${commit}..HEAD -- ${excludes}`.cwd(projectPath).quiet().nothrow()
  if (r.exitCode === 0) return Math.trunc(Number(r.stdout.toString().trim()))
  return -1
}
const isCheckRunning = async (projectPath: string): Promise<boolean> => {
  const lp = lockPath(projectPath)
  const lpExists = await file(lp).exists()
  if (!lpExists) return false
  try {
    const lock = safeParseJson(lockSchema, await file(lp).text())
    if (!lock) {
      await rm(lp)
      return false
    }
    const age = Date.now() - new Date(lock.at).getTime()
    if (age > 600_000) {
      await rm(lp)
      return false
    }
    try {
      process.kill(lock.pid, 0)
      return true
    } catch {
      await rm(lp)
      return false
    }
  } catch {
    await rm(lp)
    return false
  }
}
const writeCheckResult = async (opts: {
  pass: boolean
  projectPath: string
  summary?: string
  violations: number
}): Promise<void> => {
  const dir = checksDir()
  await mkdir(dir, { recursive: true })
  const result: CheckResult = {
    at: new Date().toISOString(),
    commit: await getHeadCommit(opts.projectPath),
    pass: opts.pass,
    summary: opts.summary,
    violations: opts.violations
  }
  await write(cachePath(opts.projectPath), JSON.stringify(result))
}
const spawnBackgroundCheck = async (projectPath: string): Promise<void> => {
  if (await isCheckRunning(projectPath)) return
  const dir = checksDir()
  await mkdir(dir, { recursive: true })
  const workerPath = join(import.meta.dir, 'check-worker.js')
  const proc = spawn(['bun', workerPath, projectPath], { stderr: 'ignore', stdin: 'ignore', stdout: 'ignore' })
  proc.unref()
}
export {
  getCodeCommitsSince,
  getHeadCommit,
  isCheckRunning,
  readCheckResult,
  readCheckResultBlocking,
  spawnBackgroundCheck,
  writeCheckResult
}
export type { CheckResult }
