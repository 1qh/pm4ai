/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: intentional catch-swallow */
/* oxlint-disable no-empty */
/* eslint-disable no-empty */
import { spawn } from 'bun'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CLAUDE_MD, VERBATIM_FILES } from './constants.js'
import { checkResultSchema, lockSchema, safeParseJson } from './schemas.js'
interface CheckResult {
  at: string
  commit: string
  pass: boolean
  summary?: string
  violations: number
}
const checksDir = () => join(homedir(), '.pm4ai', 'checks')
const leadingSepRe = /^--/u
const safeFileName = (projectPath: string) => projectPath.replaceAll('/', '--').replace(leadingSepRe, '')
const cachePath = (projectPath: string) => join(checksDir(), `${safeFileName(projectPath)}.json`)
const lockPath = (projectPath: string) => join(checksDir(), `${safeFileName(projectPath)}.lock`)
const readCheckResult = (projectPath: string): CheckResult | undefined => {
  const p = cachePath(projectPath)
  if (!existsSync(p)) return
  try {
    return safeParseJson(checkResultSchema, readFileSync(p, 'utf8'))
  } catch {}
}
const getHeadCommit = (projectPath: string): string => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectPath, stdio: 'pipe' }).toString().trim()
  } catch {}
  return ''
}
const getCodeCommitsSince = (projectPath: string, commit: string): number => {
  if (!commit) return -1
  try {
    const excludes = [CLAUDE_MD, '*.md', ...VERBATIM_FILES].map(f => `:!${f}`)
    const args = ['rev-list', '--count', `${commit}..HEAD`, '--', ...excludes]
    return Number.parseInt(execFileSync('git', args, { cwd: projectPath, stdio: 'pipe' }).toString().trim(), 10)
  } catch {}
  return -1
}
const isCheckRunning = (projectPath: string): boolean => {
  const lp = lockPath(projectPath)
  if (!existsSync(lp)) return false
  try {
    const lock = safeParseJson(lockSchema, readFileSync(lp, 'utf8'))
    if (!lock) {
      rmSync(lp)
      return false
    }
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
  const dir = checksDir()
  mkdirSync(dir, { recursive: true })
  const workerPath = join(import.meta.dir, 'check-worker.js')
  const proc = spawn(['bun', workerPath, projectPath], { stderr: 'ignore', stdin: 'ignore', stdout: 'ignore' })
  proc.unref()
}
export { getCodeCommitsSince, getHeadCommit, isCheckRunning, readCheckResult, spawnBackgroundCheck, writeCheckResult }
export type { CheckResult }
