import { $, file, write } from 'bun'
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Issue, PackageJson } from './types.js'
import {
  CLAUDE_MD,
  READONLY_UI,
  REQUIRED_ROOT_DEVDEPS,
  REQUIRED_TRUSTED_DEPS,
  SKIP_PATTERNS,
  TURBO_FLAG,
  VERBATIM_FILES
} from './constants.js'
import { inferRules } from './infer.js'
import { collectWorkspacePackages, getGhRepo, readPkg } from './utils.js'
const stripFrontmatter = (content: string): string => {
  if (!content.startsWith('---')) return content
  const endIdx = content.indexOf('---', 3)
  if (endIdx === -1) return content
  return content.slice(endIdx + 3).trim()
}
const CLEANUP_SCRIPT = `import { spawnSync } from 'node:child_process'
import pkg from '../package.json' with { type: 'json' }
const result = spawnSync('npm', ['view', pkg.name, 'versions', '--json'], { encoding: 'utf8' })
const versions = JSON.parse(result.stdout) as string[]
for (const v of versions) if (v !== pkg.version) spawnSync('npm', ['unpublish', \`\${pkg.name}@\${v}\`], { stdio: 'inherit' })
`
const gitCleanRe = /\bgit\s+clean\s+\S+\s*/gu
const syncConfigs = async (selfPath: string, projectPath: string): Promise<Issue[]> => {
  const results = await Promise.all(
    VERBATIM_FILES.map(async name => {
      const src = file(join(selfPath, name))
      const dst = file(join(projectPath, name))
      if (!(await src.exists())) return
      const srcContent = await src.text()
      const dstContent = (await dst.exists()) ? await dst.text() : ''
      if (srcContent !== dstContent) {
        await write(dst, srcContent)
        return { detail: `${name} updated`, type: 'synced' } as Issue
      }
    })
  )
  return results.filter((r): r is Issue => r !== undefined)
}
const syncClaudeMd = async (selfPath: string, projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const rulesDir = join(selfPath, 'apps', 'web', 'content', 'rules')
  if (!existsSync(rulesDir)) {
    issues.push({ detail: 'rules directory not found in pm4ai repo', type: 'error' })
    return issues
  }
  const inferred = await inferRules(projectPath, rulesDir)
  const contents = await Promise.all(inferred.map(async rule => file(join(rulesDir, `${rule}.mdx`)).text()))
  const blocks = contents.map(c => stripFrontmatter(c))
  const generated = `${blocks.join('\n\n---\n\n')}\n`
  const claudeFile = file(join(projectPath, CLAUDE_MD))
  const existing = (await claudeFile.exists()) ? await claudeFile.text() : ''
  if (generated !== existing) {
    await write(claudeFile, generated)
    issues.push({ detail: `${CLAUDE_MD} updated`, type: 'synced' })
  }
  return issues
}
const syncRootScripts = (scripts: Record<string, string>, issues: Issue[]): boolean => {
  let changed = false
  if (!scripts.clean) {
    scripts.clean = 'sh clean.sh'
    changed = true
    issues.push({ detail: 'added clean script', type: 'synced' })
  }
  if (!scripts.prepare) {
    scripts.prepare = 'bunx simple-git-hooks'
    changed = true
    issues.push({ detail: 'added prepare script', type: 'synced' })
  }
  if (!scripts.postinstall?.includes('sherif')) {
    scripts.postinstall = scripts.postinstall ? `${scripts.postinstall} && sherif` : 'sherif'
    changed = true
    issues.push({ detail: 'added sherif to postinstall', type: 'synced' })
  }
  if (!scripts.build) {
    scripts.build = `turbo build ${TURBO_FLAG}`
    changed = true
    issues.push({ detail: 'added build script', type: 'synced' })
  }
  if (!scripts.check) {
    scripts.check = 'lintmax check'
    changed = true
    issues.push({ detail: 'added check script', type: 'synced' })
  }
  if (!scripts.fix) {
    scripts.fix = 'lintmax fix'
    changed = true
    issues.push({ detail: 'added fix script', type: 'synced' })
  }
  return changed
}
const syncRootDevDeps = (pkg: PackageJson, devDeps: Record<string, string>, issues: Issue[]): boolean => {
  let changed = false
  if (!devDeps.sherif) {
    devDeps.sherif = 'latest'
    changed = true
    issues.push({ detail: 'added sherif to devDependencies', type: 'synced' })
  }
  if (!devDeps['simple-git-hooks']) {
    devDeps['simple-git-hooks'] = 'latest'
    changed = true
    issues.push({ detail: 'added simple-git-hooks to devDependencies', type: 'synced' })
  }
  const allDeps = { ...pkg.dependencies, ...devDeps }
  for (const dep of REQUIRED_ROOT_DEVDEPS)
    if (!allDeps[dep]) {
      devDeps[dep] = 'latest'
      changed = true
      issues.push({ detail: `added ${dep} to devDependencies`, type: 'synced' })
    }
  return changed
}
const syncPackageJson = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const pkgPath = join(projectPath, 'package.json')
  const pkg = await readPkg(pkgPath)
  if (!pkg) return issues
  let changed = false
  const scripts = pkg.scripts ?? {}
  pkg.scripts = scripts
  changed = syncRootScripts(scripts, issues) || changed
  if (!pkg['simple-git-hooks']) {
    pkg['simple-git-hooks'] = { 'pre-commit': 'sh up.sh && git add -u' }
    changed = true
    issues.push({ detail: 'added simple-git-hooks', type: 'synced' })
  }
  const devDeps = pkg.devDependencies ?? {}
  pkg.devDependencies = devDeps
  changed = syncRootDevDeps(pkg, devDeps, issues) || changed
  if (!pkg.packageManager) {
    const r = await $`bun --version`.quiet().nothrow()
    const bunVersion = r.stdout.toString().trim()
    if (bunVersion) {
      pkg.packageManager = `bun@${bunVersion}`
      changed = true
      issues.push({ detail: `set packageManager to bun@${bunVersion}`, type: 'synced' })
    }
  }
  const trusted = pkg.trustedDependencies ?? []
  const missingTrusted = REQUIRED_TRUSTED_DEPS.filter(d => !trusted.includes(d))
  if (missingTrusted.length > 0) {
    pkg.trustedDependencies = [...trusted, ...missingTrusted].toSorted()
    changed = true
    issues.push({ detail: `added ${missingTrusted.join(', ')} to trustedDependencies`, type: 'synced' })
  }
  if (changed) await write(file(pkgPath), `${JSON.stringify(pkg, null, 2)}\n`)
  return issues
}
interface FixPublishedPkgArgs {
  issues: Issue[]
  pkg: PackageJson
  pkgPath: string
  rel: string
  repo: string | undefined
}
const fixPublishedPkg = ({ issues, pkg, pkgPath, rel, repo }: FixPublishedPkgArgs): boolean => {
  let changed = false
  if (pkg.type !== 'module') {
    pkg.type = 'module'
    changed = true
    issues.push({ detail: `${rel} set "type": "module"`, type: 'synced' })
  }
  if (!pkg.files) {
    pkg.files = ['dist']
    changed = true
    issues.push({ detail: `${rel} set "files": ["dist"]`, type: 'synced' })
  }
  if (!pkg.license) {
    pkg.license = 'MIT'
    changed = true
    issues.push({ detail: `${rel} set "license": "MIT"`, type: 'synced' })
  }
  if (!pkg.repository && repo) {
    pkg.repository = { directory: dirname(rel), type: 'git', url: `https://github.com/${repo}` }
    changed = true
    issues.push({ detail: `${rel} added repository`, type: 'synced' })
  }
  const pubScripts = pkg.scripts ?? {}
  if (!pubScripts.postpublish) {
    const scriptDir = join(dirname(pkgPath), 'script')
    const scriptFile = join(scriptDir, 'cleanup-old-versions.ts')
    if (!existsSync(scriptFile)) {
      mkdirSync(scriptDir, { recursive: true })
      writeFileSync(scriptFile, CLEANUP_SCRIPT)
      issues.push({ detail: `${rel} created script/cleanup-old-versions.ts`, type: 'synced' })
    }
    pubScripts['cleanup-old-versions'] = 'bun script/cleanup-old-versions.ts'
    pubScripts.postpublish = 'bun run cleanup-old-versions'
    pkg.scripts = pubScripts
    changed = true
    issues.push({ detail: `${rel} added postpublish cleanup`, type: 'synced' })
  }
  return changed
}
const fixGitClean = (pkg: PackageJson, rel: string, issues: Issue[]): boolean => {
  let changed = false
  const scripts = pkg.scripts ?? {}
  for (const [name, cmd] of Object.entries(scripts)) {
    gitCleanRe.lastIndex = 0
    if (gitCleanRe.test(cmd)) {
      gitCleanRe.lastIndex = 0
      scripts[name] = cmd.replace(gitCleanRe, 'rm -rf ')
      changed = true
      issues.push({ detail: `${rel} "${name}" replaced git clean with rm -rf`, type: 'synced' })
    }
  }
  return changed
}
const isSkipped = (rel: string) => SKIP_PATTERNS.some(p => rel.includes(p.replace('/', '')))
interface HoistArgs {
  issues: Issue[]
  rel: string
  rootDevDeps: Record<string, string>
  subDevDeps: Record<string, string>
}
const hoistDevDeps = ({
  issues,
  rel,
  rootDevDeps,
  subDevDeps
}: HoistArgs): { hoisted: boolean; remaining: Record<string, string> | undefined } => {
  const external = Object.entries(subDevDeps).filter(([, v]) => !v.startsWith('workspace:'))
  if (external.length === 0)
    return { hoisted: false, remaining: Object.keys(subDevDeps).length === 0 ? undefined : subDevDeps }
  let hoisted = false
  for (const [name, version] of external)
    if (!rootDevDeps[name]) {
      rootDevDeps[name] = version
      hoisted = true
      issues.push({ detail: `hoisted ${name} from ${rel} to root`, type: 'synced' })
    }
  const ws = Object.fromEntries(Object.entries(subDevDeps).filter(([, v]) => v.startsWith('workspace:')))
  return { hoisted, remaining: Object.keys(ws).length === 0 ? undefined : ws }
}
interface FixSubEntryArgs {
  entry: { path: string; pkg: PackageJson }
  issues: Issue[]
  projectPath: string
  repo: string | undefined
}
const fixSubEntry = ({ entry, issues, projectPath, repo }: FixSubEntryArgs): boolean => {
  const rel = entry.path.replace(`${projectPath}/`, '')
  let changed = false
  if (rel.startsWith('apps/') && !entry.pkg.private) {
    entry.pkg.private = true
    changed = true
    issues.push({ detail: `${rel} set to private`, type: 'synced' })
  }
  const isPublished = !entry.pkg.private && (entry.pkg.exports ?? entry.pkg.main ?? entry.pkg.bin) && entry.pkg.name
  if (isPublished) changed = fixPublishedPkg({ issues, pkg: entry.pkg, pkgPath: entry.path, rel, repo }) || changed
  return fixGitClean(entry.pkg, rel, issues) || changed
}
interface HoistSubEntryArgs {
  entry: { path: string; pkg: PackageJson }
  issues: Issue[]
  projectPath: string
  rootDevDeps: Record<string, string>
}
const hoistSubEntry = ({
  entry,
  issues,
  projectPath,
  rootDevDeps
}: HoistSubEntryArgs): { changed: boolean; hoisted: boolean; pkg: PackageJson; pkgPath: string } => {
  const rel = entry.path.replace(`${projectPath}/`, '')
  const originalDevDeps = entry.pkg.devDependencies
  const { hoisted, remaining } = hoistDevDeps({ issues, rel, rootDevDeps, subDevDeps: originalDevDeps ?? {} })
  const changed = remaining !== originalDevDeps && !(remaining === undefined && !originalDevDeps)
  if (changed) entry.pkg.devDependencies = remaining
  return { changed, hoisted, pkg: entry.pkg, pkgPath: entry.path }
}
const syncSubPackages = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const entries = await collectWorkspacePackages(projectPath)
  const rootPkgPath = join(projectPath, 'package.json')
  const repo = await getGhRepo(projectPath)
  const subEntries = entries.filter(e => e.path !== rootPkgPath)
  const writes: Promise<number>[] = []
  for (const entry of subEntries) {
    const changed = fixSubEntry({ entry, issues, projectPath, repo })
    if (changed) writes.push(write(file(entry.path), `${JSON.stringify(entry.pkg, null, 2)}\n`))
  }
  await Promise.all(writes)
  const rootPkg = await readPkg(rootPkgPath)
  if (!rootPkg) return issues
  let rootChanged = false
  const rootDevDeps = rootPkg.devDependencies ?? {}
  const subWrites: Promise<number>[] = []
  const nonSkipped = subEntries.filter(e => !isSkipped(e.path.replace(`${projectPath}/`, '')))
  for (const entry of nonSkipped) {
    const result = hoistSubEntry({ entry, issues, projectPath, rootDevDeps })
    if (result.hoisted) rootChanged = true
    if (result.changed) subWrites.push(write(file(result.pkgPath), `${JSON.stringify(result.pkg, null, 2)}\n`))
  }
  await Promise.all(subWrites)
  if (rootChanged) {
    rootPkg.devDependencies = rootDevDeps
    await write(file(rootPkgPath), `${JSON.stringify(rootPkg, null, 2)}\n`)
  }
  return issues
}
const syncUi = (cnsyncPath: string, projectPath: string): Issue[] => {
  const issues: Issue[] = []
  const src = join(cnsyncPath, READONLY_UI)
  const dst = join(projectPath, READONLY_UI)
  if (!existsSync(src)) {
    issues.push({ detail: `${READONLY_UI} not found in cnsync repo`, type: 'error' })
    return issues
  }
  if (projectPath === cnsyncPath) return issues
  cpSync(src, dst, { recursive: true })
  issues.push({ detail: `${READONLY_UI} updated`, type: 'synced' })
  return issues
}
export { syncClaudeMd, syncConfigs, syncPackageJson, syncSubPackages, syncUi }
