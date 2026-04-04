/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: intentional catch-swallow */
/* oxlint-disable no-empty */
/* eslint-disable no-empty */
import { spawn } from 'bun'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { projectName } from './utils.js'
interface CheckResult {
  at: string
  commit: string
  pass: boolean
  summary?: string
  violations: number
}
const checksDir = () => join(homedir(), '.pm4ai', 'checks')
const cachePath = (projectPath: string) => join(checksDir(), `${projectName(projectPath)}.json`)
const lockPath = (projectPath: string) => join(checksDir(), `${projectName(projectPath)}.lock`)
const readCheckResult = (projectPath: string): CheckResult | undefined => {
  const p = cachePath(projectPath)
  if (!existsSync(p)) return
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as CheckResult
  } catch {}
}
const getHeadCommit = (projectPath: string): string => {
  try {
    return execSync('git rev-parse HEAD', { cwd: projectPath, stdio: 'pipe' }).toString().trim()
  } catch {}
  return ''
}
const getCommitsSince = (projectPath: string, commit: string): number => {
  if (!commit) return -1
  try {
    return Number.parseInt(
      execSync(`git rev-list --count ${commit}..HEAD`, { cwd: projectPath, stdio: 'pipe' }).toString().trim(),
      10
    )
  } catch {}
  return -1
}
const isCheckRunning = (projectPath: string): boolean => {
  const lp = lockPath(projectPath)
  if (!existsSync(lp)) return false
  try {
    const lock = JSON.parse(readFileSync(lp, 'utf8')) as { at: string; pid: number }
    const age = Date.now() - new Date(lock.at).getTime()
    if (age > 600_000) {
      rmSync(lp)
      return false
    }
    try {
      process.kill(lock.pid, 0)
      return true
    } catch {
      rmSync(lp)
      return false
    }
  } catch {
    rmSync(lp)
    return false
  }
}
const writeCheckResult = (opts: { pass: boolean; projectPath: string; summary?: string; violations: number }) => {
  const dir = checksDir()
  mkdirSync(dir, { recursive: true })
  const result: CheckResult = {
    at: new Date().toISOString(),
    commit: getHeadCommit(opts.projectPath),
    pass: opts.pass,
    summary: opts.summary,
    violations: opts.violations
  }
  writeFileSync(cachePath(opts.projectPath), JSON.stringify(result))
}
const spawnBackgroundCheck = (projectPath: string) => {
  if (isCheckRunning(projectPath)) return
  const workerPath = join(import.meta.dir, 'check-worker.js')
  const proc = spawn(['bun', workerPath, projectPath], { stderr: 'ignore', stdin: 'ignore', stdout: 'ignore' })
  proc.unref()
}
export { getCommitsSince, getHeadCommit, isCheckRunning, readCheckResult, spawnBackgroundCheck, writeCheckResult }
export type { CheckResult }
