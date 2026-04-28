import { $, file, Glob } from 'bun'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Issue, IssueType } from './types.js'
import { ALL_BANNED, BUN_GLOBALS, LINTMAX_ONLY, TEMPORARY } from './banned.js'
import {
  DEFAULT_SCRIPTS,
  EXPECTED,
  FORBIDDEN_LOCKFILES,
  FUMADOCS_DARK_CSS,
  MUST_EXIST_FILES,
  RG_EXCLUDE,
  UI_PACKAGE_NAME,
  VERBATIM_FILES
} from './constants.js'
import { debug, getGhRepo, getTsconfigTypes, readJson, readPkg, rel } from './utils.js'
const SCAN_EXCLUDE = new Set(['.git', '.next', '.turbo', '.vercel', 'dist', 'node_modules', 'readonly', 'templates'])
const glob = async (pattern: string, cwd: string): Promise<string[]> => {
  const results: string[] = []
  const dot = pattern.includes('/.')
  for await (const f of new Glob(pattern).scan({ cwd, dot, onlyFiles: true }))
    if (!f.split('/').some(seg => SCAN_EXCLUDE.has(seg))) results.push(join(cwd, f))
  return results
}
const shell = async (projectPath: string, ...args: string[]) => {
  const result = await $`rg ${args} ${projectPath} -g '*.ts' -g '*.tsx' ${RG_EXCLUDE} -l`.quiet().nothrow()
  return result.stdout.toString().trim()
}
const relList = (files: string, base: string) =>
  files
    .split('\n')
    .map(f => rel(f, base))
    .join(', ')
const issue = (type: IssueType, detail: string): Issue => ({ detail, type })
const drift = (detail: string) => issue('drift', detail)
const forbidden = (detail: string) => issue('forbidden', detail)
const providerJsxRe = /<\w+Provider/gu
const serverProviderRe = /<\w*Server\w*Provider/u
const providerImportRe = /from\s+['"].*providers/u
const checkCi = async (projectPath: string): Promise<Issue[]> => {
  const repo = await getGhRepo(projectPath)
  if (!repo) return []
  const result =
    await $`gh run list --repo ${repo} --limit 1 --json conclusion,createdAt --jq '.[0] | "\(.conclusion) \(.createdAt)"'`
      .quiet()
      .nothrow()
  if (result.exitCode !== 0) {
    debug('command failed:', `gh run list --repo ${repo}`)
    return []
  }
  const [conclusion, time] = result.stdout.toString().trim().split(' ')
  if (conclusion === 'failure') return [issue('ci', `failed ${time ?? ''}`)]
  if (conclusion === 'success') return [issue('info', `passed ${time ?? ''}`)]
  return []
}
const checkGit = async (projectPath: string): Promise<Issue[]> => {
  const dirtyCheck = await $`git status --porcelain`.cwd(projectPath).quiet().nothrow()
  if (!dirtyCheck.stdout.toString().trim()) await $`git pull --rebase`.cwd(projectPath).quiet().nothrow()
  const result = await $`git status --porcelain`.cwd(projectPath).quiet().nothrow()
  if (result.exitCode !== 0) debug('command failed:', 'git status --porcelain')
  const out = result.stdout.toString().trim()
  if (!out) return []
  return [issue('git', `${out.split('\n').length} uncommitted changes`)]
}
const checkDrift = async (selfPath: string, projectPath: string): Promise<Issue[]> => {
  const results = await Promise.all(
    VERBATIM_FILES.map(async name => {
      const src = file(join(selfPath, name))
      const dst = file(join(projectPath, name))
      if (!(await src.exists())) return
      if (!(await dst.exists())) return issue('file', `${name} missing`)
      const [s, d] = await Promise.all([src.text(), dst.text()])
      if (s !== d) return issue('file', `${name} out of sync`)
    })
  )
  return results.filter((r): r is Issue => r !== undefined)
}
const checkRootPkg = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const pkg = await readPkg(join(projectPath, 'package.json'))
  if (!pkg) return issues
  if (!pkg.private) issues.push(drift('root package.json should be private'))
  if (!pkg.packageManager) issues.push(issue('missing', 'packageManager field missing'))
  if (!pkg['simple-git-hooks']) issues.push(issue('missing', 'simple-git-hooks in package.json'))
  else if (pkg['simple-git-hooks']['pre-commit'] !== EXPECTED.preCommit)
    issues.push(drift(`pre-commit should be "${EXPECTED.preCommit}"`))
  if (pkg.scripts?.prepare !== DEFAULT_SCRIPTS.prepare)
    issues.push(drift(`prepare should be "${DEFAULT_SCRIPTS.prepare}"`))
  if (!pkg.scripts?.postinstall?.includes('sherif'))
    issues.push(drift(`postinstall should include "${DEFAULT_SCRIPTS.postinstall}"`))
  if (pkg.scripts?.clean && !pkg.scripts.clean.startsWith(DEFAULT_SCRIPTS.clean))
    issues.push(drift(`clean should start with "${DEFAULT_SCRIPTS.clean}"`))
  return issues
}
const checkConfigs = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const isGitHub = Boolean(await getGhRepo(projectPath))
  for (const entry of MUST_EXIST_FILES)
    if (!((entry.includes('.github/') && !isGitHub) || existsSync(join(projectPath, entry))))
      issues.push(issue('missing', entry))
  const pkg = await readPkg(join(projectPath, 'package.json'))
  if (pkg && !pkg.scripts?.action) issues.push(issue('missing', '"action" script missing'))
  const ts = await readJson(join(projectPath, 'tsconfig.json'))
  if (ts) {
    if (ts.extends && ts.extends !== EXPECTED.tsconfigExtends)
      issues.push(drift('tsconfig.json should extend lintmax/tsconfig'))
    if (ts.include) issues.push(drift('root tsconfig.json should not have "include"'))
    const types = getTsconfigTypes(ts)
    if (!types?.includes('bun-types')) issues.push(issue('missing', 'root tsconfig.json missing "bun-types"'))
  }
  const v = await readJson(join(projectPath, 'vercel.json'))
  if (v?.installCommand && v.installCommand !== EXPECTED.vercelInstall)
    issues.push(drift('vercel.json installCommand should be "bun i"'))
  return issues
}
const LAYOUT_REQUIRED: [string, string][] = [
  ['suppressHydrationWarning', 'missing suppressHydrationWarning on <html>'],
  ['antialiased', 'missing antialiased on <body>'],
  ['tracking-[-0.02em]', 'missing tracking-[-0.02em] on <html>'],
  ['min-h-screen', 'missing min-h-screen on <body>'],
  ['font-sans', 'missing font-sans on <html>'],
  ['Metadata', 'missing metadata export']
]
const LAYOUT_FORBIDDEN: [string, string][] = [
  ['RootLayout', 'use Layout not RootLayout'],
  ['export default function', 'use arrow function + export default Layout']
]
interface ContentRules {
  content: string
  must: [string, string][]
  mustNot: [string, string][]
  r: string
}
const checkContent = ({ content, must, mustNot, r }: ContentRules): Issue[] => {
  const issues: Issue[] = []
  for (const [check, msg] of must) if (!content.includes(check)) issues.push(drift(`${msg}: ${r}`))
  for (const [check, msg] of mustNot) if (content.includes(check)) issues.push(drift(`${msg}: ${r}`))
  return issues
}
const checkLayouts = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const files = await glob('**/app/layout.tsx', projectPath)
  await Promise.all(
    files.map(async layoutFile => {
      const content = await file(layoutFile).text()
      const r = rel(layoutFile, projectPath)
      if (!content.includes('<html')) return
      issues.push(...checkContent({ content, must: LAYOUT_REQUIRED, mustNot: LAYOUT_FORBIDDEN, r }))
      if (content.includes("'./globals.css'") || content.includes('"./globals.css"'))
        issues.push(drift(`use global.css not globals.css: ${r}`))
      const dir = layoutFile.replace('/layout.tsx', '')
      if (!existsSync(join(dir, 'fonts.ts'))) issues.push(drift(`missing fonts.ts next to layout: ${r}`))
      if (content.includes('Providers') && !existsSync(join(dir, 'providers.tsx')))
        issues.push(drift(`providers.tsx should be next to layout: ${r}`))
      const providerMatches = content.match(providerJsxRe) ?? []
      if (providerMatches.some(m => !serverProviderRe.test(m)) && !providerImportRe.test(content))
        issues.push(drift(`Provider in layout, move to providers.tsx: ${r}`))
    })
  )
  return issues
}
const checkPages = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const files = await glob('**/app/**/page.tsx', projectPath)
  await Promise.all(
    files.map(async pageFile => {
      const content = await file(pageFile).text()
      if (content.includes('export default function'))
        issues.push(drift(`use arrow function + export default Page: ${rel(pageFile, projectPath)}`))
    })
  )
  return issues
}
const checkNextConfigs = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const configs = await glob('**/next.config.ts', projectPath)
  await Promise.all(
    configs.map(async configFile => {
      const content = await file(configFile).text()
      if (!(content.includes('reactStrictMode') || content.includes('createNextConfig')))
        issues.push(drift(`missing reactStrictMode in ${rel(configFile, projectPath)}`))
    })
  )
  for (const f of await glob('**/apps/*/postcss.config.*', projectPath))
    issues.push(drift(`redundant ${rel(f, projectPath)}, remove it`))
  return issues
}
const checkAppTsconfigs = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const files = await glob('**/apps/*/tsconfig.json', projectPath)
  await Promise.all(
    files.map(async tsconfigFile => {
      const content = await file(tsconfigFile).text()
      const r = rel(tsconfigFile, projectPath)
      if (!content.includes('"extends"')) issues.push(drift(`${r} should extend lintmax/tsconfig`))
      if (content.includes('"include"')) issues.push(drift(`${r} should not have "include"`))
    })
  )
  return issues
}
const checkForbidden = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  for (const f of FORBIDDEN_LOCKFILES)
    if (existsSync(join(projectPath, f))) issues.push(forbidden(`${f} found, use bun only`))
  const [bunLockTracked, tsNoCheck] = await Promise.all([
    $`git ls-files bun.lock`.cwd(projectPath).quiet().nothrow(),
    $`rg '^// @ts-nocheck|^/\* @ts-nocheck' ${projectPath} -g '*.ts' -g '*.tsx' ${RG_EXCLUDE} -l`.quiet().nothrow()
  ])
  if (bunLockTracked.stdout.toString().trim()) issues.push(forbidden('bun.lock tracked in git, should be gitignored'))
  const gitignores = await glob('**/.gitignore', projectPath)
  const nested = gitignores.filter(f => f !== join(projectPath, '.gitignore'))
  if (nested.length > 0) issues.push(drift(`nested .gitignore: ${nested.map(f => rel(f, projectPath)).join(', ')}`))
  const mjsConfigs = await glob('**/postcss.config.mjs', projectPath)
  if (mjsConfigs.length > 0) issues.push(drift('postcss.config.mjs should be .ts'))
  const tsNoCheckFiles = tsNoCheck.stdout.toString().trim()
  if (tsNoCheckFiles) issues.push(forbidden(`@ts-nocheck in: ${relList(tsNoCheckFiles, projectPath)}`))
  return issues
}
const checkBannedImports = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const isLintmax = projectPath.includes('/lintmax')
  const banned = [...ALL_BANNED, ...(isLintmax ? [] : LINTMAX_ONLY)].filter(b => !TEMPORARY.has(b.ban))
  const sourceResults = await Promise.all(
    banned.map(async ({ ban, fix }) => {
      const files = await shell(projectPath, ban)
      if (files) return { ban, files, fix }
    })
  )
  const pkgJsonFiles = await glob('**/package.json', projectPath)
  const pkgResults = await Promise.all(
    pkgJsonFiles.map(async pkgPath => {
      const raw = await readPkg(pkgPath)
      if (!raw) return []
      const depNames = Object.keys({ ...raw.dependencies, ...raw.devDependencies, ...raw.peerDependencies })
      return banned
        .filter(({ ban }) => {
          const clean = ban.replaceAll(/^"|"$/gu, '')
          return ban.endsWith('"') ? depNames.includes(clean) : depNames.some(d => d.startsWith(clean))
        })
        .map(({ ban, fix }) => ({ ban, files: pkgPath, fix }))
    })
  )
  for (const r of [...sourceResults, ...pkgResults.flat()])
    if (r) issues.push(forbidden(`${r.ban} banned, use ${r.fix}: ${relList(r.files, projectPath)}`))
  const bunGlobalResult =
    await $`rg 'Bun\.\w+' ${projectPath} -g '*.ts' -g '*.tsx' -g '!*.d.ts' ${RG_EXCLUDE} -o --no-filename`
      .quiet()
      .nothrow()
  const bunGlobals = bunGlobalResult.stdout.toString().trim()
  if (bunGlobals) {
    const fixable = [...new Set(bunGlobals.split('\n'))].filter(g => BUN_GLOBALS[g])
    if (fixable.length > 0)
      issues.push(forbidden(`use named imports: ${fixable.map(g => `${g} → ${BUN_GLOBALS[g]}`).join(', ')}`))
  }
  const deepUi = await shell(projectPath, `${UI_PACKAGE_NAME}/lib/`)
  if (deepUi)
    issues.push(forbidden(`use import { cn } from '${UI_PACKAGE_NAME}', not deep paths: ${relList(deepUi, projectPath)}`))
  return issues
}
const checkVercel = async (projectPath: string): Promise<Issue[]> => {
  if (!existsSync(join(projectPath, '.vercel'))) return []
  const result = await $`bunx vercel@latest ls`.cwd(projectPath).quiet().nothrow()
  if (result.exitCode !== 0) {
    debug('command failed:', 'bunx vercel@latest ls')
    return []
  }
  const latestLine = result.stdout
    .toString()
    .trim()
    .split('\n')
    .find(l => l.includes('●'))
  if (latestLine?.includes('● Error')) return [issue('deploy', 'vercel deployment failed')]
  return []
}
const checkFumadocsCss = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const pkgFiles = await glob('**/package.json', projectPath)
  const pkgResults = await Promise.all(
    pkgFiles.map(async pkgPath => {
      const pkg = await readPkg(pkgPath)
      if (!pkg) return
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
      if (allDeps['fumadocs-ui']) return pkgPath
    })
  )
  const fumadocsApps = pkgResults.filter((p): p is string => p !== undefined)
  const cssResults = await Promise.all(
    fumadocsApps.map(async pkgPath => {
      const appDir = pkgPath.replace('/package.json', '')
      const cssFiles = await glob('**/app/global.css', appDir)
      return Promise.all(
        cssFiles.map(async cssFile => {
          const content = await file(cssFile).text()
          if (!content.includes(FUMADOCS_DARK_CSS))
            return drift(`missing true-black dark mode CSS: ${rel(cssFile, projectPath)}`)
        })
      )
    })
  )
  for (const results of cssResults) for (const r of results) if (r) issues.push(r)
  return issues
}
const checkMergeMarkers = async (projectPath: string): Promise<Issue[]> => {
  const result = await $`rg -l --multiline-dotall -n '^(<{7}|={7}|>{7})' ${projectPath} ${RG_EXCLUDE}`.quiet().nothrow()
  const out = result.stdout.toString().trim()
  if (!out) return []
  return [forbidden(`unresolved merge markers in: ${relList(out, projectPath)}`)]
}
const ENV_LINE_RE = /^\s*(?<key>[A-Za-z_][A-Za-z0-9_]*)\s*=/u
const GENERATED_API_RE = /\/_generated\/api\.d\.ts$/u
const ENV_CANDIDATES = ['apps/backend/.env', '.env', 'apps/convex/.env']
const parseEnvKeys = (text: string): Set<string> => {
  const keys = new Set<string>()
  for (const line of text.split('\n')) {
    const m = ENV_LINE_RE.exec(line)
    const key = m?.groups?.key
    if (key && !line.trim().startsWith('#')) keys.add(key)
  }
  return keys
}
const checkConvexSelfHosted = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const generated = await glob('**/convex/_generated/api.d.ts', projectPath)
  if (generated.length === 0) return issues
  const envFiles = await Promise.all(
    ENV_CANDIDATES.map(async cand => {
      const p = join(projectPath, cand)
      if (!existsSync(p)) return null
      const text = await file(p).text()
      return text.includes('CONVEX_SELF_HOSTED_URL') ? { p, text } : null
    })
  )
  const envHit = envFiles.find((e): e is { p: string; text: string } => e !== null)
  if (!envHit) return issues
  const envKeys = parseEnvKeys(envHit.text)
  const convexDirs = generated.map(g => g.replace(GENERATED_API_RE, ''))
  const [nodeEnvHits, setHits, pkgFiles] = await Promise.all([
    Promise.all(
      convexDirs.map(async d =>
        $`rg -l "process\.env(\.NODE_ENV|\['NODE_ENV'\]|\[\"NODE_ENV\"\]).*['\"]production['\"]" ${d} -g '*.ts' -g '*.tsx' -g '!_generated/**' -g '!*.test.ts' ${RG_EXCLUDE}`
          .quiet()
          .nothrow()
      )
    ),
    $`rg -l 'convex env set' ${projectPath} -g '*.ts' -g '*.tsx' -g '!**/sync*.ts' -g '!**/scripts/test-*.ts' -g '!**/global-setup*.ts' ${RG_EXCLUDE}`
      .quiet()
      .nothrow(),
    glob('**/package.json', projectPath)
  ])
  for (const r of nodeEnvHits) {
    const out = r.stdout.toString().trim()
    if (out)
      issues.push(
        forbidden(
          `NODE_ENV === 'production' branch in convex/ (always true on self-hosted; gate on explicit env flag instead): ${relList(out, projectPath)}`
        )
      )
  }
  const setOut = setHits.stdout.toString().trim()
  if (setOut)
    issues.push(forbidden(`'convex env set' outside sync.ts (.env is source of truth): ${relList(setOut, projectPath)}`))
  const pkgs = await Promise.all(pkgFiles.map(async p => readPkg(p)))
  const usesAuth = pkgs.some(pkg => Boolean({ ...pkg?.dependencies, ...pkg?.devDependencies }['@convex-dev/auth']))
  if (usesAuth)
    for (const k of ['JWT_PRIVATE_KEY', 'JWKS'])
      if (!envKeys.has(k))
        issues.push(issue('missing', `${k} required by @convex-dev/auth in ${rel(envHit.p, projectPath)}`))
  if (!envKeys.has('SITE_URL'))
    issues.push(issue('missing', `SITE_URL required for Convex auth callbacks in ${rel(envHit.p, projectPath)}`))
  return issues
}
export {
  checkAppTsconfigs,
  checkBannedImports,
  checkCi,
  checkConfigs,
  checkConvexSelfHosted,
  checkDrift,
  checkForbidden,
  checkFumadocsCss,
  checkGit,
  checkLayouts,
  checkMergeMarkers,
  checkNextConfigs,
  checkPages,
  checkRootPkg,
  checkVercel
}
