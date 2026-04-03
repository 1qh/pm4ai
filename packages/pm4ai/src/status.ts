import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { discover } from './discover.js'
import { audit } from './audit.js'
import { readLog } from './log.js'
import type { Issue } from './audit.js'

const runCapture = async (cmd: string[], cwd: string) => {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', cwd })
  const stdout = await new Response(proc.stdout).text()
  await proc.exited
  return stdout.trim()
}

const checkGit = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []

  const statusOut = await runCapture(['git', 'status', '--porcelain'], projectPath)
  if (statusOut) {
    const count = statusOut.split('\n').length
    issues.push({ type: 'git', detail: `${count} uncommitted changes` })
  }

  await runCapture(['git', 'fetch'], projectPath)
  const behindOut = await runCapture(['git', 'rev-list', '--count', 'HEAD..@{u}'], projectPath)
  const behind = parseInt(behindOut, 10)
  if (behind > 0) {
    issues.push({ type: 'git', detail: `${behind} commits behind remote` })
  }

  const aheadOut = await runCapture(['git', 'rev-list', '--count', '@{u}..HEAD'], projectPath)
  const ahead = parseInt(aheadOut, 10)
  if (ahead > 0) {
    issues.push({ type: 'git', detail: `${ahead} commits ahead of remote` })
  }

  return issues
}

const checkDrift = (selfPath: string, projectPath: string): Issue[] => {
  const issues: Issue[] = []
  const files = ['clean.sh', 'up.sh', 'bunfig.toml', '.gitignore']

  for (const file of files) {
    const src = join(selfPath, file)
    const dst = join(projectPath, file)
    if (!existsSync(src)) {
      // Source missing
    } else if (!existsSync(dst)) {
      issues.push({ type: 'file', detail: `${file} missing` })
    } else {
      const srcContent = readFileSync(src, 'utf-8')
      const dstContent = readFileSync(dst, 'utf-8')
      if (srcContent !== dstContent) {
        issues.push({ type: 'file', detail: `${file} out of sync` })
      }
    }
  }

  return issues
}

const checkExists = (projectPath: string): Issue[] => {
  const issues: Issue[] = []

  const mustExist = ['turbo.json', 'tsconfig.json', '.github/workflows/ci.yml', 'LEARNING.md', 'RULES.md', 'PROGRESS.md', 'PLAN.md']
  for (const file of mustExist) {
    if (!existsSync(join(projectPath, file))) {
      issues.push({ type: 'missing', detail: file })
    }
  }

  const pkgPath = join(projectPath, 'package.json')
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    if (!pkg['simple-git-hooks']) {
      issues.push({ type: 'missing', detail: 'simple-git-hooks in package.json' })
    }
    if (!pkg.scripts?.prepare) {
      issues.push({ type: 'missing', detail: 'prepare script in package.json' })
    }
  }

  return issues
}

const formatIssues = (projectPath: string, issues: Issue[]): string => {
  if (issues.length === 0) return ''
  const lines = [projectPath]
  for (const issue of issues) {
    lines.push(`  ${issue.type} ${issue.detail}`)
  }
  return lines.join('\n')
}

const formatSwiftBar = (allIssues: Map<string, Issue[]>): string => {
  const hasAny = [...allIssues.values()].some(i => i.length > 0)
  const lines: string[] = []

  if (hasAny) {
    lines.push(':xmark.circle.fill: | sfcolor=red')
  } else {
    lines.push(':checkmark.circle.fill: | sfcolor=green')
  }

  lines.push('---')

  for (const [path, issues] of allIssues) {
    const name = path.split('/').pop() ?? path
    if (issues.length === 0) {
      lines.push(`${name} | sfimage=checkmark.circle sfcolor=green`)
    } else {
      lines.push(`${name} | sfimage=xmark.circle sfcolor=red`)
      for (const issue of issues) {
        lines.push(`--${issue.type}: ${issue.detail}`)
      }
    }
  }

  return lines.join('\n')
}

export const status = async (swiftbar = false) => {
  const { self, consumers } = await discover()
  const log = readLog()
  const allIssues = new Map<string, Issue[]>()

  const checks = consumers.map(async project => {
    const issues: Issue[] = []

    const [gitIssues, driftIssues, existIssues, auditIssues] = await Promise.all([
      checkGit(project.path),
      Promise.resolve(checkDrift(self.path, project.path)),
      Promise.resolve(checkExists(project.path)),
      audit(project.path)
    ])

    issues.push(...gitIssues, ...driftIssues, ...existIssues, ...auditIssues)

    const logEntry = log.find(e => e.path === project.path)
    if (logEntry && !logEntry.pass) {
      issues.push({ type: 'up.sh', detail: `failed ${logEntry.at}` })
    }

    allIssues.set(project.path, issues)
  })

  await Promise.all(checks)

  if (swiftbar) {
    console.log(formatSwiftBar(allIssues))
  } else {
    for (const [path, issues] of allIssues) {
      const output = formatIssues(path, issues)
      if (output) {
        console.log(output)
        console.log()
      }
    }
  }
}
