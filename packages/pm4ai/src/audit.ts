import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'

export type Issue = {
  type: string
  detail: string
}

const runCapture = async (cmd: string[], cwd: string) => {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', cwd })
  const stdout = await new Response(proc.stdout).text()
  await proc.exited
  return stdout.trim()
}

const getLatestNpmVersion = async (pkg: string): Promise<string | undefined> => {
  const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`)
  if (!res.ok) return undefined
  const data = await res.json()
  return data.version
}

const getLatestBunVersion = async (): Promise<string | undefined> => {
  const res = await fetch('https://api.github.com/repos/oven-sh/bun/releases/latest')
  if (!res.ok) return undefined
  const data = await res.json()
  return (data.tag_name as string).replace('bun-v', '')
}

const collectPkgJsons = (projectPath: string): { path: string; pkg: Record<string, unknown> }[] => {
  const results: { path: string; pkg: Record<string, unknown> }[] = []
  const rootPkgPath = join(projectPath, 'package.json')
  if (!existsSync(rootPkgPath)) return results

  const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'))
  results.push({ path: rootPkgPath, pkg: rootPkg })

  const workspaces: string[] = rootPkg.workspaces ?? []
  for (const ws of workspaces) {
    const pattern = ws.replace('/*', '')
    const wsDir = join(projectPath, pattern)
    if (!existsSync(wsDir)) {
      // Skip missing workspace directories
    } else {
      const entries = readdirSync(wsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const pkgPath = join(wsDir, entry.name, 'package.json')
          if (existsSync(pkgPath)) {
            results.push({ path: pkgPath, pkg: JSON.parse(readFileSync(pkgPath, 'utf-8')) })
          }
        }
      }
    }
  }

  return results
}

export const audit = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const pkgs = collectPkgJsons(projectPath)
  const rootPkg = pkgs[0]?.pkg

  const bunVersion = (rootPkg?.packageManager as string | undefined)?.replace('bun@', '')
  if (bunVersion) {
    const latest = await getLatestBunVersion()
    if (latest && bunVersion !== latest) {
      issues.push({ type: 'bun', detail: `${bunVersion} behind latest ${latest}` })
    }
  }

  const lintmaxLatest = await getLatestNpmVersion('lintmax')
  if (lintmaxLatest) {
    const resolved = await runCapture(['bun', 'why', 'lintmax'], projectPath)
    if (resolved && !resolved.includes(lintmaxLatest)) {
      issues.push({ type: 'lintmax', detail: `resolved version behind latest ${lintmaxLatest}` })
    }
  }

  const allDeps = new Map<string, string[]>()

  for (const { path: pkgPath, pkg } of pkgs) {
    const shortPath = pkgPath.replace(projectPath + '/', '')
    for (const field of ['dependencies', 'devDependencies']) {
      const deps = pkg[field] as Record<string, string> | undefined
      if (!deps) {
        // No deps in this field
      } else {
        for (const [name, version] of Object.entries(deps)) {
          if (version !== 'latest' && !version.startsWith('workspace:')) {
            issues.push({ type: 'dep', detail: `${name} not on latest tag (${version}) in ${shortPath}` })
          }

          const key = name
          if (!allDeps.has(key)) {
            allDeps.set(key, [])
          }
          allDeps.get(key)!.push(shortPath)
        }
      }
    }
  }

  for (const [name, locations] of allDeps) {
    if (locations.length > 1 && !name.startsWith('@types/')) {
      issues.push({ type: 'duplicate', detail: `${name} declared in ${locations.join(', ')}` })
    }
  }

  return issues
}
