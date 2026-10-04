import { $, write } from 'bun'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { statePath } from './state-dir.js'
const projectPath = process.argv[2]
if (!projectPath) throw new Error('project path required')
const safeName = projectPath.replaceAll('/', '--').replace(/^--/u, '')
const dir = statePath('checks')
const cp = join(dir, `${safeName}.json`)
const lp = join(dir, `${safeName}.lock`)
await mkdir(dir, { recursive: true })
await write(lp, JSON.stringify({ at: new Date().toISOString(), pid: process.pid }))
const getCommit = async (): Promise<string> => {
  const r = await $`git rev-parse HEAD`.cwd(projectPath).quiet().nothrow()
  return r.exitCode === 0 ? r.stdout.toString().trim() : ''
}
const commit = await getCommit()
try {
  const result = await $`bun run check`.cwd(projectPath).quiet().nothrow()
  if (result.exitCode === 0)
    await write(cp, JSON.stringify({ at: new Date().toISOString(), commit, pass: true, violations: 0 }))
  else {
    const out = [result.stderr.toString(), result.stdout.toString()].join('') || ''
    const lines = out.split('\n').filter(Boolean)
    const summary = lines.slice(-3).join('; ').slice(0, 200)
    await write(
      cp,
      JSON.stringify({ at: new Date().toISOString(), commit, pass: false, summary, violations: lines.length })
    )
  }
} finally {
  try {
    await rm(lp)
  } catch {
    // Already removed
  }
}
