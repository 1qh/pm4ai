import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const alwaysRules = ['general', 'bun', 'typescript', 'code-quality', 'lintmax', 'git']

const depRuleMap: Record<string, string[]> = {
  next: ['react-nextjs'],
  tailwindcss: ['minimal-dom', 'shadcn'],
  playwright: ['testing'],
  tsdown: ['tsdown']
}

const getAllDeps = (projectPath: string): Set<string> => {
  const deps = new Set<string>()
  const addFromPkg = (pkgPath: string) => {
    if (!existsSync(pkgPath)) return
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      if (pkg[field]) {
        for (const name of Object.keys(pkg[field])) {
          deps.add(name)
        }
      }
    }
  }

  addFromPkg(join(projectPath, 'package.json'))

  const rootPkg = JSON.parse(readFileSync(join(projectPath, 'package.json'), 'utf-8'))
  const workspaces: string[] = rootPkg.workspaces ?? []
  for (const ws of workspaces) {
    const pattern = ws.replace('/*', '')
    const { readdirSync } = require('fs')
    if (!existsSync(join(projectPath, pattern))) {
      // Not a valid workspace directory
    } else {
      const entries = readdirSync(join(projectPath, pattern), { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          addFromPkg(join(projectPath, pattern, entry.name, 'package.json'))
        }
      }
    }
  }

  return deps
}

export const inferRules = (projectPath: string): string[] => {
  const deps = getAllDeps(projectPath)
  const rules = [...alwaysRules]

  for (const [dep, ruleNames] of Object.entries(depRuleMap)) {
    if (deps.has(dep)) {
      for (const rule of ruleNames) {
        if (!rules.includes(rule)) {
          rules.push(rule)
        }
      }
    }
  }

  return rules
}
