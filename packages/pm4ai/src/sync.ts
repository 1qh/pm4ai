/* eslint-disable @typescript-eslint/no-dynamic-delete, complexity, max-depth */
/** biome-ignore-all lint/performance/noDelete: must delete pkg keys */
import { $, file, write } from 'bun'
import { cpSync, existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Issue, PackageJson } from './types.js'
import { isPublishedPkg } from './audit.js'
import {
  CLAUDE_MD,
  DEFAULT_DEP_VERSION,
  DEFAULT_FILES,
  DEFAULT_LICENSE,
  DEFAULT_SCRIPTS,
  EXPECTED,
  filterTurboWorkspaceWarning,
  READONLY_UI,
  REQUIRED_ROOT_DEVDEPS,
  TSDOWN_BASE,
  TURBO_FLAG,
  TURBO_WARNING_FILTER
} from './constants.js'
import { inferRules } from './infer.js'
import { DEP_FIELDS } from './types.js'
import {
  buildPkgDepMap,
  collectWorkspacePackages,
  getGhRepo,
  getTsconfigTypes,
  gitCleanRe,
  isExtended,
  isSkippedPath,
  readJson,
  readPkg,
  resolveManagedFiles,
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
const FRONTMATTER_TITLE_RE = /^title:\s*(?<title>.+)$/mu
const frontmatterTitle = (content: string): string | undefined => {
  if (!content.startsWith('---')) return
  const endIdx = content.indexOf('---', 3)
  if (endIdx === -1) return
  return FRONTMATTER_TITLE_RE.exec(content.slice(3, endIdx))?.groups?.title?.trim()
}
const ruleBlock = (content: string): string => {
  const title = frontmatterTitle(content)
  const body = stripFrontmatter(content)
  return title ? `# ${title}\n\n${body}` : body
}
const syncConfigs = async (selfPath: string, projectPath: string): Promise<Issue[]> => {
  const managed = await resolveManagedFiles(projectPath)
  const results = await Promise.all(
    managed.map(async ({ extendable, path: name }) => {
      const src = file(join(selfPath, name))
      const dst = file(join(projectPath, name))
      if (!(await src.exists())) return
      const srcContent = await src.text()
      const dstContent = (await dst.exists()) ? await dst.text() : ''
      if (extendable && isExtended(srcContent, dstContent)) return
      if (srcContent !== dstContent) {
        await write(dst, srcContent)
        return { detail: `${name} updated`, type: 'synced' } satisfies Issue
      }
    })
  )
  return results.filter((r): r is Issue => r !== undefined)
}
const canonicaliseViaLintmax = async (rawContent: string, relName: string, projectPath: string): Promise<string> => {
  const lintmaxBin = join(projectPath, 'node_modules', '.bin', 'lintmax')
  if (!existsSync(lintmaxBin)) return rawContent
  const cacheDir = join(projectPath, 'node_modules', '.cache', 'canon')
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true })
  const tmpRel = join('node_modules', '.cache', 'canon', relName.replaceAll('/', '_'))
  const tmpPath = join(projectPath, tmpRel)
  await write(file(tmpPath), rawContent)
  await $`${lintmaxBin} fix ${tmpRel}`.cwd(projectPath).quiet().nothrow()
  const formatted = await file(tmpPath).text()
  try {
    rmSync(tmpPath)
  } catch {
    /* leftover lives under node_modules/.cache/ — invisible to git + cleaned with node_modules */
  }
  return formatted
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
  const blocks = contents.map(c => ruleBlock(c))
  const generated = await canonicaliseViaLintmax(`${blocks.join('\n\n---\n\n')}\n`, CLAUDE_MD, projectPath)
  const claudeFile = file(join(projectPath, CLAUDE_MD))
  const existing = (await claudeFile.exists()) ? await claudeFile.text() : ''
  if (generated !== existing) {
    await write(claudeFile, generated)
    issues.push({ detail: `${CLAUDE_MD} updated`, type: 'synced' })
  }
  return issues
}
const isLintmaxScriptCanonical = (script: string | undefined, fallback: string, command: 'check' | 'fix'): boolean => {
  const value = script ?? ''
  return value.endsWith(fallback) || value.endsWith(`cli.js ${command}`) || value.endsWith(`cli.mjs ${command}`)
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
    } else if (
      name === 'fix' || name === 'check' ? !isLintmaxScriptCanonical(scripts[name], value, name) : scripts[name] !== value
    ) {
      const action = scripts[name] ? 'updated' : 'added'
      scripts[name] = value
      changed = true
      issues.push({ detail: `${action} ${name} script`, type: 'synced' })
    }
  for (const [name, cmd] of Object.entries(scripts))
    if (
      !name.startsWith('dev') &&
      cmd.includes('turbo') &&
      cmd.includes(TURBO_FLAG) &&
      !cmd.includes(TURBO_WARNING_FILTER)
    ) {
      scripts[name] = filterTurboWorkspaceWarning(cmd)
      changed = true
      issues.push({ detail: `updated ${name} script to filter turbo workspace warning`, type: 'synced' })
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
  for (const dep of depPkgs)
    if (dep)
      for (const other of allRootDepNames)
        if (other !== dep.depName && dep.transitive[other] && devDeps[other] && !required.has(other)) {
          delete devDeps[other]
          changed = true
          issues.push({ detail: `removed redundant "${other}" (provided by ${dep.depName})`, type: 'synced' })
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
  copy?: string[]
  entry: string[]
}
const inferTsdownConfig = (pkg: PackageJson, pkgDir: string): TsdownConfig | undefined => {
  const entry: string[] = []
  const copy: string[] = []
  const { exports } = pkg
  if (exports)
    for (const [key, val] of Object.entries(exports)) {
      const importPath = typeof val === 'string' ? val : val.import
      if (importPath)
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
  const config: TsdownConfig = { entry }
  if (copy.length > 0) config.copy = copy
  return config
}
const serializeTsdownConfig = (config: TsdownConfig): string => {
  const fields = [
    `  clean: ${TSDOWN_BASE.clean},`,
    `  deps: { neverBundle: [${TSDOWN_BASE.deps.neverBundle.map(d => `'${d}'`).join(', ')}] },`,
    `  dts: ${TSDOWN_BASE.dts},`
  ]
  if (config.copy) fields.push(`  copy: [${config.copy.map(c => `'${c}'`).join(', ')}],`)
  fields.push(
    `  entry: [${config.entry.map(e => `'${e}'`).join(', ')}],`,
    `  format: '${TSDOWN_BASE.format}',`,
    `  outDir: '${TSDOWN_BASE.outDir}'`
  )
  return `import { defineConfig } from 'tsdown'\n\nexport default defineConfig({\n${fields.join('\n')}\n})\n`
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
  const srcContent = readFileSync(readmeSrc, 'utf8')
  if (existsSync(readmeDst)) {
    let isSymlink: boolean
    try {
      readlinkSync(readmeDst)
      isSymlink = true
    } catch {
      isSymlink = false
    }
    if (!isSymlink && readFileSync(readmeDst, 'utf8') === srcContent) return false
    if (isSymlink) rmSync(readmeDst)
  }
  writeFileSync(readmeDst, srcContent)
  issues.push({ detail: `${rel} synced README.md`, type: 'synced' })
  return true
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
    if (existingContent.includes('dts: false') || existingContent.includes('onSuccess')) {
      /* Skip — existing config has custom overrides */
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
  const expectedPostpublish = 'bun ../../tools/prune-versions.ts'
  if (pubScripts.postpublish !== expectedPostpublish) {
    pubScripts.postpublish = expectedPostpublish
    delete pubScripts['cleanup-old-versions']
    pkg.scripts = pubScripts
    changed = true
    issues.push({ detail: `${rel} set postpublish to prune-versions script`, type: 'synced' })
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
  if (isSkippedPath(rel)) return false
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
        if (deps) {
          for (const [name, version] of Object.entries(deps))
            if (!version.startsWith('workspace:') && providedByWs.has(name)) {
              delete deps[name]
              dedupChanged = true
              issues.push({ detail: `${rel} removed duplicate "${name}" (provided by workspace dep)`, type: 'synced' })
            }
          if (Object.keys(deps).length === 0) delete entry.pkg[field]
        }
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
  const pkgPath = join(projectPath, 'package.json')
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>
    const { workspaces } = pkg
    if (Array.isArray(workspaces) && !workspaces.includes(READONLY_UI)) {
      workspaces.push(READONLY_UI)
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
      issues.push({ detail: `added ${READONLY_UI} to workspaces`, type: 'synced' })
    }
  }
  issues.push({ detail: `${READONLY_UI} updated`, type: 'synced' })
  return issues
}
const NEXT_BUILD_RE = /(?<!bunx --bun )\bnext build\b/gu
const FUMADOCS_MDX_RE = /(?<!bunx --bun )\bfumadocs-mdx\b/gu
const patchFumadocsScript = (script: string): string =>
  script.replace(NEXT_BUILD_RE, 'bunx --bun next build').replace(FUMADOCS_MDX_RE, 'bunx --bun fumadocs-mdx')
const syncFumadocsBuild = async (projectPath: string): Promise<Issue[]> => {
  const entries = await collectWorkspacePackages(projectPath)
  const fumadocsApps = entries.filter(e => {
    const allDeps = { ...e.pkg.dependencies, ...e.pkg.devDependencies }
    return Boolean(allDeps['fumadocs-ui'])
  })
  const issues: Issue[] = []
  for (const app of fumadocsApps) {
    const scripts = app.pkg.scripts ?? {}
    let changed = false
    const next = { ...scripts }
    for (const [k, v] of Object.entries(scripts)) {
      const patched = patchFumadocsScript(v)
      if (patched !== v) {
        next[k] = patched
        changed = true
      }
    }
    if (changed) {
      writeFileSync(app.path, `${JSON.stringify({ ...app.pkg, scripts: next }, null, 2)}\n`)
      const rel = app.path.replace(`${projectPath}/`, '')
      issues.push({ detail: `${rel} prefixed fumadocs/next build with bunx --bun`, type: 'synced' })
    }
  }
  return issues
}
const getProjectGithubUrl = async (projectPath: string): Promise<string | undefined> => {
  const r = await $`gh repo view --json url -q .url`.cwd(projectPath).quiet().nothrow()
  if (r.exitCode !== 0) return
  const url = r.stdout.toString().trim()
  return url || undefined
}
const ALIAS_TRIM_RE = /\/\*$/u
const ALIAS_DOT_SLASH_RE = /^\.\//u
const resolveLibBase = async (appDir: string): Promise<string> => {
  const tsconfig = await readJson(join(appDir, 'tsconfig.json'))
  const paths = (tsconfig?.compilerOptions as undefined | { paths?: Record<string, string[]> })?.paths
  const aliasTarget = paths?.['@/*']?.[0]
  if (!aliasTarget) return 'src'
  return aliasTarget.replace(ALIAS_TRIM_RE, '').replace(ALIAS_DOT_SLASH_RE, '') || '.'
}
const layoutSharedRel = (libBase: string): string =>
  libBase === '.' ? 'lib/layout.shared.tsx' : `${libBase}/lib/layout.shared.tsx`
const layoutSharedTemplate = (title: string, githubUrl: string): string =>
  `import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
export const baseOptions = (): BaseLayoutProps => ({
  githubUrl: '${githubUrl}',
  nav: {
    title: '${title}'
  }
})
`
const SCOPED_PREFIX_RE = /^@[^/]+\//u
const GITHUB_URL_KEY_RE = /\bgithubUrl\s*:/u
const BASEOPTIONS_OPEN_RE = /(?<open>\(\)[^=]*=>\s*\(\{\s*\n)/u
const stripScopedPrefix = (name: string): string => name.replace(SCOPED_PREFIX_RE, '')
interface PatchArgs {
  githubUrl: string
  projectPath: string
  sharedPath: string
  title: string
}
const patchSharedFile = ({ githubUrl, projectPath, sharedPath, title }: PatchArgs): Issue | undefined => {
  const relShared = sharedPath.replace(`${projectPath}/`, '')
  if (!existsSync(sharedPath)) {
    mkdirSync(dirname(sharedPath), { recursive: true })
    writeFileSync(sharedPath, layoutSharedTemplate(title, githubUrl))
    return { detail: `${relShared} created with baseOptions + githubUrl`, type: 'synced' }
  }
  const content = readFileSync(sharedPath, 'utf8')
  if (GITHUB_URL_KEY_RE.test(content)) return
  const next = content.replace(BASEOPTIONS_OPEN_RE, `$<open>  githubUrl: '${githubUrl}',\n`)
  if (next === content) return
  writeFileSync(sharedPath, next)
  return { detail: `${relShared} added githubUrl`, type: 'synced' }
}
const syncFumadocsGithubUrl = async (projectPath: string): Promise<Issue[]> => {
  const entries = await collectWorkspacePackages(projectPath)
  const fumadocsApps = entries.filter(e => {
    const allDeps = { ...e.pkg.dependencies, ...e.pkg.devDependencies }
    return Boolean(allDeps['fumadocs-ui'])
  })
  if (fumadocsApps.length === 0) return []
  const githubUrl = await getProjectGithubUrl(projectPath)
  if (!githubUrl) return []
  const results = await Promise.all(
    fumadocsApps.map(async app => {
      const appDir = dirname(app.path)
      const libBase = await resolveLibBase(appDir)
      return patchSharedFile({
        githubUrl,
        projectPath,
        sharedPath: join(appDir, layoutSharedRel(libBase)),
        title: stripScopedPrefix(app.pkg.name ?? 'docs')
      })
    })
  )
  return results.filter((r): r is Issue => r !== undefined)
}
export {
  serializeTsdownConfig,
  syncClaudeMd,
  syncConfigs,
  syncFumadocsBuild,
  syncFumadocsGithubUrl,
  syncPackageJson,
  syncSubPackages,
  syncTsconfig,
  syncUi
}
