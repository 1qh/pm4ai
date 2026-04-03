import { existsSync, mkdirSync, copyFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { discover } from './discover.js'
import { syncConfigs, syncClaudeMd, syncUi } from './sync.js'
import { audit } from './audit.js'
import { updateLog } from './log.js'
import type { Issue } from './audit.js'

const runCapture = async (cmd: string[], cwd: string) => {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', cwd })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() }
}

const gitPull = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const { stdout: statusOut } = await runCapture(['git', 'status', '--porcelain'], projectPath)

  if (statusOut) {
    issues.push({ type: 'git', detail: 'dirty, skipping pull' })
    return issues
  }

  await runCapture(['git', 'fetch'], projectPath)
  const { stdout: behindOut } = await runCapture(['git', 'rev-list', '--count', 'HEAD..@{u}'], projectPath)
  const behind = parseInt(behindOut, 10)

  if (behind > 0) {
    await runCapture(['git', 'pull'], projectPath)
    issues.push({ type: 'git', detail: `pulled ${behind} commits` })
  }

  return issues
}

const maintain = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const upSh = join(projectPath, 'up.sh')

  if (!existsSync(upSh)) {
    issues.push({ type: 'up.sh', detail: 'missing, cannot maintain' })
    return issues
  }

  const { exitCode, stderr } = await runCapture(['sh', 'up.sh'], projectPath)

  if (exitCode === 0) {
    const snapshotDir = join(homedir(), '.pm4ai', 'snapshots', projectPath.split('/').pop() ?? 'unknown')
    const lockfile = join(projectPath, 'bun.lock')
    if (existsSync(lockfile)) {
      mkdirSync(snapshotDir, { recursive: true })
      copyFileSync(lockfile, join(snapshotDir, 'bun.lock'))
    }
  } else {
    const errorLine = stderr.split('\n').filter(Boolean).pop() ?? 'unknown error'
    issues.push({ type: 'up.sh', detail: `failed: ${errorLine}` })
  }

  updateLog({
    project: projectPath.split('/').pop() ?? 'unknown',
    path: projectPath,
    pass: exitCode === 0,
    at: new Date().toISOString(),
    error: exitCode === 0 ? undefined : stderr.slice(0, 500)
  })

  return issues
}

export const fix = async () => {
  const { self, cnsync, consumers } = await discover()

  console.log(`found ${consumers.length} projects`)
  console.log()

  const allProjects = [self, cnsync, ...consumers.filter(c => !c.isCnsync)]
  const pullResults = await Promise.all(allProjects.map(async p => ({
    name: p.name,
    issues: await gitPull(p.path)
  })))

  for (const r of pullResults) {
    for (const issue of r.issues) {
      console.log(`${r.name}: ${issue.detail}`)
    }
  }

  const tasks = consumers.map(async project => {
    const issues: Issue[] = []

    issues.push(...syncConfigs(self.path, project.path))
    issues.push(...syncClaudeMd(self.path, project.path))

    if (existsSync(join(project.path, 'readonly'))) {
      issues.push(...syncUi(cnsync.path, project.path))
    }

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
}
