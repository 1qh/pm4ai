/* eslint-disable @typescript-eslint/no-dynamic-delete, complexity, max-depth, no-continue */
/** biome-ignore-all lint/performance/noDelete: must delete pkg keys */
/** biome-ignore-all lint/nursery/noContinue: loop control flow */
import { $, file, write } from 'bun'
import { cpSync, existsSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { Issue, PackageJson } from './types.js'
import { isPublishedPkg } from './audit.js'
import {
  CLAUDE_MD,
  DEFAULT_DEP_VERSION,
  DEFAULT_FILES,
  DEFAULT_LICENSE,
  DEFAULT_SCRIPTS,
  EXPECTED,
  READONLY_UI,
  REQUIRED_ROOT_DEVDEPS,
  VERBATIM_FILES
} from './constants.js'
import { inferRules } from './infer.js'
import { DEP_FIELDS } from './types.js'
import {
  buildPkgDepMap,
  collectWorkspacePackages,
  getGhRepo,
  getTsconfigTypes,
  gitCleanRe,
  isSkippedPath,
  readJson,
  readPkg,
  writeJson
} from './utils.js'
const sortKeys = (obj: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(obj).toSorted(([a], [b]) => a.localeCompare(b)))
const stripFrontmatter = (content: string): string => {
  if (!content.startsWith('---')) return content
  const endIdx = content.indexOf('---', 3)
  if (endIdx === -1) return content
  return content.slice(endIdx + 3).trim()
}
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
        return { detail: `${name} updated`, type: 'synced' } satisfies Issue
      }
    })
  )
  return results.filter((r): r is Issue => r !== undefined)
}
const syncClaudeMd = async (selfPath: string, projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const rulesDir = join(selfPath, 'apps', 'docs', 'content', 'rules')
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
  for (const [name, value] of Object.entries(DEFAULT_SCRIPTS))
    if (name === 'postinstall') {
      if (!scripts.postinstall?.includes('sherif')) {
        scripts.postinstall = scripts.postinstall ? `${scripts.postinstall} && sherif` : DEFAULT_SCRIPTS.postinstall
        changed = true
        issues.push({ detail: 'added sherif to postinstall', type: 'synced' })
      }
    } else if (!scripts[name]) {
      scripts[name] = value
      changed = true
      issues.push({ detail: `added ${name} script`, type: 'synced' })
    }
  return changed
}
const syncRootDevDeps = (pkg: PackageJson, devDeps: Record<string, string>, issues: Issue[]): boolean => {
  let changed = false
  const allDeps = { ...pkg.dependencies, ...devDeps }
  for (const dep of REQUIRED_ROOT_DEVDEPS)
    if (!allDeps[dep]) {
      devDeps[dep] = DEFAULT_DEP_VERSION
      changed = true
      issues.push({ detail: `added ${dep} to devDependencies`, type: 'synced' })
    }
  return changed
}
const syncPackageJson = async (projectPath: string, selfPath?: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const pkgPath = join(projectPath, 'package.json')
  const pkg = await readPkg(pkgPath)
  if (!pkg) return issues
  const wasPrivate = Boolean(pkg.private)
  if (!pkg.private) {
    pkg.private = true
    issues.push({ detail: 'set root package.json to private', type: 'synced' })
  }
  const scripts = pkg.scripts ?? {}
  pkg.scripts = scripts
  const hadHooks = Boolean(pkg['simple-git-hooks'])
  if (!pkg['simple-git-hooks']) {
    pkg['simple-git-hooks'] = { 'pre-commit': EXPECTED.preCommit }
    issues.push({ detail: 'added simple-git-hooks', type: 'synced' })
  }
  // oxlint-disable-next-line no-useless-assignment
  let changed = syncRootScripts(scripts, issues) || !wasPrivate || !hadHooks
  const devDeps = pkg.devDependencies ?? {}
  pkg.devDependencies = devDeps
  changed = syncRootDevDeps(pkg, devDeps, issues) || changed
  const allRootDeps = { ...pkg.dependencies, ...devDeps }
  const allRootDepNames = Object.keys(allRootDeps)
  const required = new Set(REQUIRED_ROOT_DEVDEPS)
  const depPkgs = await Promise.all(
    allRootDepNames.map(async depName => {
      const depPkg = await readPkg(join(projectPath, 'node_modules', depName, 'package.json'))
      return depPkg ? { depName, transitive: depPkg.dependencies ?? {} } : undefined
    })
  )
  for (const dep of depPkgs) {
    if (!dep) continue
    for (const other of allRootDepNames)
      if (other !== dep.depName && dep.transitive[other] && devDeps[other] && !required.has(other)) {
        delete devDeps[other]
        changed = true
        issues.push({ detail: `removed redundant "${other}" (provided by ${dep.depName})`, type: 'synced' })
      }
  }
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
  let requiredTrusted: string[] = []
  if (selfPath) {
    const selfPkgPath = join(selfPath, 'package.json')
    const selfPkg = JSON.parse(await file(selfPkgPath).text()) as PackageJson
    requiredTrusted = selfPkg.trustedDependencies ?? []
  }
  const missingTrusted = requiredTrusted.filter(d => !trusted.includes(d))
  if (missingTrusted.length > 0) {
    pkg.trustedDependencies = [...trusted, ...missingTrusted].toSorted()
    changed = true
    issues.push({ detail: `added ${missingTrusted.join(', ')} to trustedDependencies`, type: 'synced' })
  }
  if (!scripts.action?.startsWith('sh up.sh')) {
    scripts.action = scripts.action ? `sh up.sh && ${scripts.action}` : 'sh up.sh'
    changed = true
    issues.push({ detail: 'action must start with "sh up.sh"', type: 'synced' })
  }
  if (changed) {
    pkg.devDependencies = sortKeys(pkg.devDependencies ?? {})
    await writeJson(pkgPath, pkg)
  }
  return issues
}
const syncTsconfig = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const tsconfigPath = join(projectPath, 'tsconfig.json')
  const tsconfig = await readJson(tsconfigPath)
  if (!tsconfig) return issues
  let changed = false
  if ('include' in tsconfig) {
    delete tsconfig.include
    changed = true
    issues.push({ detail: 'removed "include" from root tsconfig.json', type: 'synced' })
  }
  if (tsconfig.extends !== EXPECTED.tsconfigExtends) {
    tsconfig.extends = EXPECTED.tsconfigExtends
    changed = true
    issues.push({ detail: `set tsconfig extends to "${EXPECTED.tsconfigExtends}"`, type: 'synced' })
  }
  if (!getTsconfigTypes(tsconfig)?.includes('bun-types')) {
    const co = (tsconfig.compilerOptions ?? {}) as Record<string, unknown>
    co.types = ['bun-types']
    tsconfig.compilerOptions = co
    changed = true
    issues.push({ detail: 'added "bun-types" to tsconfig compilerOptions.types', type: 'synced' })
  }
  if (changed) await writeJson(tsconfigPath, tsconfig)
  return issues
}
interface FixPublishedPkgArgs {
  issues: Issue[]
  pkg: PackageJson
  pkgPath: string
  rel: string
  repo: string | undefined
}
const distPrefixRe = /^\.?\/?dist\//u
const dotSlashRe = /^\.\//u
const mjsExtRe = /\.mjs$/u
const monorepoRootRe = /\/(?:packages|tool|lib)\/[^/]+$/u
const resolveExportSource = (key: string, importPath: string, pkgDir: string): string | undefined => {
  if (importPath.endsWith('.json')) return
  const srcBase = key === '.' ? 'src/index' : `src/${key.replace(dotSlashRe, '')}`
  for (const ext of ['.ts', '.tsx']) if (existsSync(join(pkgDir, `${srcBase}${ext}`))) return `${srcBase}${ext}`
}
interface TsdownConfig {
  clean: true
  copy?: string[]
  dts: true
  entry: string[]
  format: 'esm'
  outDir: 'dist'
}
const inferTsdownConfig = (pkg: PackageJson, pkgDir: string): TsdownConfig | undefined => {
  const entry: string[] = []
  const copy: string[] = []
  const { exports } = pkg
  if (exports)
    for (const [key, val] of Object.entries(exports)) {
      const importPath = typeof val === 'string' ? val : val.import
      if (!importPath) continue
      if (importPath.endsWith('.css')) {
        const srcCss = importPath.replace(distPrefixRe, 'src/')
        if (existsSync(join(pkgDir, srcCss))) copy.push(srcCss)
      } else {
        const src = resolveExportSource(key, importPath, pkgDir)
        if (src) entry.push(src)
      }
    }
  if (pkg.bin) {
    const bins = typeof pkg.bin === 'string' ? { default: pkg.bin } : pkg.bin
    for (const binPath of Object.values(bins)) {
      const srcPath = binPath.replace(distPrefixRe, 'src/').replace(mjsExtRe, '.ts')
      if (existsSync(join(pkgDir, srcPath)) && !entry.includes(srcPath)) entry.push(srcPath)
    }
  }
  if (entry.length === 0 && !pkg.bin)
    if (existsSync(join(pkgDir, 'src/index.ts'))) entry.push('src/index.ts')
    else if (existsSync(join(pkgDir, 'src/index.tsx'))) entry.push('src/index.tsx')
  if (entry.length === 0) return
  const config: TsdownConfig = { clean: true, dts: true, entry, format: 'esm', outDir: 'dist' }
  if (copy.length > 0) config.copy = copy
  return config
}
const serializeTsdownConfig = (config: TsdownConfig): string => {
  const lines = ["import { defineConfig } from 'tsdown'", 'export default defineConfig({', '  clean: true,']
  if (config.copy) lines.push(`  copy: [${config.copy.map(c => `'${c}'`).join(', ')}],`)
  lines.push('  dts: true,')
  lines.push(`  entry: [${config.entry.map(e => `'${e}'`).join(', ')}],`)
  lines.push("  format: 'esm',")
  lines.push("  outDir: 'dist'")
  lines.push('})')
  return `${lines.join('\n')}\n`
}
const syncReadmeSymlink = ({
  issues,
  monorepoRoot,
  pkgDir,
  rel
}: {
  issues: Issue[]
  monorepoRoot: string
  pkgDir: string
  rel: string
}): boolean => {
  const readmeSrc = join(monorepoRoot, 'README.md')
  const readmeDst = join(pkgDir, 'README.md')
  if (!existsSync(readmeSrc)) return false
  if (existsSync(readmeDst))
    try {
      if (readlinkSync(readmeDst) === relative(pkgDir, readmeSrc)) return false
    } catch {
      return false
    }
  try {
    symlinkSync(relative(pkgDir, readmeSrc), readmeDst)
    issues.push({ detail: `${rel} symlinked README.md`, type: 'synced' })
    return true
  } catch {
    return false
  }
}
const fixPublishedPkg = ({ issues, pkg, pkgPath, rel, repo }: FixPublishedPkgArgs): boolean => {
  let changed = false
  if (pkg.type !== 'module') {
    pkg.type = 'module'
    changed = true
    issues.push({ detail: `${rel} set "type": "module"`, type: 'synced' })
  }
  if (!pkg.files) {
    pkg.files = DEFAULT_FILES
    changed = true
    issues.push({ detail: `${rel} set "files": ${JSON.stringify(DEFAULT_FILES)}`, type: 'synced' })
  }
  if (!pkg.license) {
    pkg.license = DEFAULT_LICENSE
    changed = true
    issues.push({ detail: `${rel} set "license": "${DEFAULT_LICENSE}"`, type: 'synced' })
  }
  if (!pkg.repository && repo) {
    pkg.repository = { directory: dirname(rel), type: 'git', url: `https://github.com/${repo}` }
    changed = true
    issues.push({ detail: `${rel} added repository`, type: 'synced' })
  }
  const pubScripts = pkg.scripts ?? {}
  if (pubScripts.build && pubScripts.build !== 'tsdown') {
    pubScripts.build = 'tsdown'
    pkg.scripts = pubScripts
    changed = true
    issues.push({ detail: `${rel} set build to "tsdown"`, type: 'synced' })
  }
  const pkgDir = dirname(pkgPath)
  const tsdownConfigPath = join(pkgDir, 'tsdown.config.ts')
  const tsdownConfig = inferTsdownConfig(pkg, pkgDir)
  if (tsdownConfig) {
    const existingContent = existsSync(tsdownConfigPath) ? readFileSync(tsdownConfigPath, 'utf8') : ''
    if (existingContent.includes('dts: false')) {
      /* Skip — existing config has dts disabled intentionally */
    } else {
      const generatedContent = serializeTsdownConfig(tsdownConfig)
      if (existingContent !== generatedContent) {
        writeFileSync(tsdownConfigPath, generatedContent)
        issues.push({ detail: `${rel} generated tsdown.config.ts`, type: 'synced' })
      }
    }
  }
  const monorepoRoot = pkgDir.replace(monorepoRootRe, '')
  syncReadmeSymlink({ issues, monorepoRoot, pkgDir, rel })
  const expectedPostpublish = 'bunx pm4ai@latest cleanup'
  if (pubScripts.postpublish !== expectedPostpublish) {
    pubScripts.postpublish = expectedPostpublish
    delete pubScripts['cleanup-old-versions']
    pkg.scripts = pubScripts
    changed = true
    issues.push({ detail: `${rel} set postpublish to pm4ai cleanup`, type: 'synced' })
  }
  if (pubScripts.build && pubScripts.prepublishOnly !== 'bun run build') {
    pubScripts.prepublishOnly = 'bun run build'
    pkg.scripts = pubScripts
    changed = true
    issues.push({ detail: `${rel} set prepublishOnly to always build before publish`, type: 'synced' })
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
  const isPublished = isPublishedPkg(entry.pkg)
  if (isPublished) changed = fixPublishedPkg({ issues, pkg: entry.pkg, pkgPath: entry.path, rel, repo }) || changed
  if (entry.pkg.scripts?.clean) {
    delete entry.pkg.scripts.clean
    if (Object.keys(entry.pkg.scripts).length === 0) delete entry.pkg.scripts
    changed = true
    issues.push({ detail: `${rel} removed redundant "clean" script`, type: 'synced' })
  }
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
const syncSubPackages = async (_selfPath: string, projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const entries = await collectWorkspacePackages(projectPath)
  const rootPkgPath = join(projectPath, 'package.json')
  const repo = await getGhRepo(projectPath)
  const subEntries = entries.filter(e => e.path !== rootPkgPath)
  const writes: Promise<number>[] = []
  for (const entry of subEntries) {
    const changed = fixSubEntry({ entry, issues, projectPath, repo })
    if (changed) writes.push(writeJson(entry.path, entry.pkg))
  }
  const pkgDepsByName = buildPkgDepMap(entries)
  for (const entry of subEntries) {
    const rel = entry.path.replace(`${projectPath}/`, '')
    if (!(isSkippedPath(rel) || rel.startsWith('apps/'))) {
      const allDeps = [...Object.entries(entry.pkg.dependencies ?? {}), ...Object.entries(entry.pkg.devDependencies ?? {})]
      const wsDeps = allDeps.filter(([, v]) => v.startsWith('workspace:')).map(([n]) => n)
      const providedByWs = new Set<string>()
      for (const ws of wsDeps) for (const d of pkgDepsByName.get(ws) ?? []) providedByWs.add(d)
      let dedupChanged = false
      for (const field of DEP_FIELDS) {
        const deps = entry.pkg[field]
        if (!deps) continue
        for (const [name, version] of Object.entries(deps))
          if (!version.startsWith('workspace:') && providedByWs.has(name)) {
            delete deps[name]
            dedupChanged = true
            issues.push({ detail: `${rel} removed duplicate "${name}" (provided by workspace dep)`, type: 'synced' })
          }
        if (Object.keys(deps).length === 0) delete entry.pkg[field]
      }
      if (dedupChanged) writes.push(writeJson(entry.path, entry.pkg))
    }
  }
  await Promise.all(writes)
  const rootPkg = await readPkg(rootPkgPath)
  if (!rootPkg) return issues
  let rootChanged = false
  const rootDevDeps = rootPkg.devDependencies ?? {}
  const subWrites: Promise<number>[] = []
  const nonSkipped = subEntries.filter(e => !isSkippedPath(e.path.replace(`${projectPath}/`, '')))
  for (const entry of nonSkipped) {
    const result = hoistSubEntry({ entry, issues, projectPath, rootDevDeps })
    if (result.hoisted) rootChanged = true
    if (result.changed) subWrites.push(writeJson(result.pkgPath, result.pkg))
  }
  await Promise.all(subWrites)
  if (rootChanged) {
    rootPkg.devDependencies = sortKeys(rootDevDeps)
    await writeJson(rootPkgPath, rootPkg)
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
  for (const ext of ['mjs', 'ts', 'js']) {
    const p = join(dst, `postcss.config.${ext}`)
    if (existsSync(p)) rmSync(p)
  }
  issues.push({ detail: `${READONLY_UI} updated`, type: 'synced' })
  return issues
}
export { syncClaudeMd, syncConfigs, syncPackageJson, syncSubPackages, syncTsconfig, syncUi }
