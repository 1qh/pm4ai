import { execSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
const projectPath = process.argv[2]
if (!projectPath) throw new Error('project path required')
const name = projectPath.split('/').pop() ?? ''
const dir = join(homedir(), '.pm4ai', 'checks')
const cp = join(dir, `${name}.json`)
const lp = join(dir, `${name}.lock`)
mkdirSync(dir, { recursive: true })
writeFileSync(lp, JSON.stringify({ at: new Date().toISOString(), pid: process.pid }))
const getCommit = (): string => {
  try {
    return execSync('git rev-parse HEAD', { cwd: projectPath, stdio: 'pipe' }).toString().trim()
  } catch {
    return ''
  }
}
const commit = getCommit()
try {
  execSync('bun run check', { cwd: projectPath, stdio: 'pipe' })
  writeFileSync(cp, JSON.stringify({ at: new Date().toISOString(), commit, pass: true, violations: 0 }))
} catch (error: unknown) {
  const err = error as { stderr?: Buffer; stdout?: Buffer }
  const out = (err.stderr ?? err.stdout ?? Buffer.from('')).toString()
  const lines = out.split('\n').filter(Boolean)
  const summary = lines.slice(-3).join('; ').slice(0, 200)
  writeFileSync(
    cp,
    JSON.stringify({ at: new Date().toISOString(), commit, pass: false, summary, violations: lines.length })
  )
} finally {
  try {
    rmSync(lp)
  } catch {
    // Already removed
  }
}
