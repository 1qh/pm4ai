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
  const cp = cachePath(projectPath)
  const lp = lockPath(projectPath)
  const dir = checksDir()
  const script = [
    `const {execSync} = require('child_process')`,
    `const {mkdirSync, writeFileSync, rmSync} = require('fs')`,
    `mkdirSync(${JSON.stringify(dir)}, {recursive: true})`,
    `writeFileSync(${JSON.stringify(lp)}, JSON.stringify({pid: process.pid, at: new Date().toISOString()}))`,
    `let commit = ''`,
    `try { commit = execSync('git rev-parse HEAD', {cwd: ${JSON.stringify(projectPath)}, stdio: 'pipe'}).toString().trim() } catch {}`,
    'try {',
    `  execSync('bun run check', {cwd: ${JSON.stringify(projectPath)}, stdio: 'pipe'})`,
    `  writeFileSync(${JSON.stringify(cp)}, JSON.stringify({at: new Date().toISOString(), pass: true, violations: 0, commit}))`,
    '} catch(e) {',
    `  const out = (e.stderr || e.stdout || '').toString()`,
    String.raw`  const m = out.match(/(\d+)\s*(error|violation|problem|issue)/i)`,
    '  const v = m ? parseInt(m[1]) : 1',
    `  const summary = out.split('\\n').filter(Boolean).slice(-3).join('; ').slice(0, 200)`,
    `  writeFileSync(${JSON.stringify(cp)}, JSON.stringify({at: new Date().toISOString(), pass: false, violations: v, summary, commit}))`,
    '} finally {',
    `  try { rmSync(${JSON.stringify(lp)}) } catch {}`,
    '}'
  ].join('\n')
  const proc = spawn(['bun', '-e', script], { stderr: 'ignore', stdin: 'ignore', stdout: 'ignore' })
  proc.unref()
}
export { getCommitsSince, getHeadCommit, isCheckRunning, readCheckResult, spawnBackgroundCheck, writeCheckResult }
export type { CheckResult }
