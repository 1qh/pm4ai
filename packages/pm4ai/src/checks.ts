import { $, file, Glob } from 'bun'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Issue } from './types.js'
import { ALL_BANNED, BUN_GLOBALS, LINTMAX_ONLY, TEMPORARY } from './banned.js'
import {
  DEFAULT_SCRIPTS,
  EXPECTED,
  FORBIDDEN_LOCKFILES,
  MUST_EXIST_FILES,
  RG_EXCLUDE,
  UI_PACKAGE_NAME,
  VERBATIM_FILES
} from './constants.js'
import { debug, getGhRepo, readJson, readPkg } from './utils.js'
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
const rel = (fullPath: string, base: string) => fullPath.replace(`${base}/`, '')
const relList = (files: string, base: string) =>
  files
    .split('\n')
    .map(f => rel(f, base))
    .join(', ')
const drift = (detail: string): Issue => ({ detail, type: 'drift' })
const forbidden = (detail: string): Issue => ({ detail, type: 'forbidden' })
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
  if (conclusion === 'failure') return [{ detail: `failed ${time ?? ''}`, type: 'ci' }]
  if (conclusion === 'success') return [{ detail: `passed ${time ?? ''}`, type: 'info' }]
  return []
}
const checkGit = async (projectPath: string): Promise<Issue[]> => {
  const dirtyCheck = await $`git status --porcelain`.cwd(projectPath).quiet().nothrow()
  if (!dirtyCheck.stdout.toString().trim()) await $`git pull --rebase`.cwd(projectPath).quiet().nothrow()
  const result = await $`git status --porcelain`.cwd(projectPath).quiet().nothrow()
  if (result.exitCode !== 0) debug('command failed:', 'git status --porcelain')
  const out = result.stdout.toString().trim()
  if (!out) return []
  return [{ detail: `${out.split('\n').length} uncommitted changes`, type: 'git' }]
}
const checkDrift = async (selfPath: string, projectPath: string): Promise<Issue[]> => {
  const results = await Promise.all(
    VERBATIM_FILES.map(async name => {
      const src = file(join(selfPath, name))
      const dst = file(join(projectPath, name))
      if (!(await src.exists())) return
      if (!(await dst.exists())) return { detail: `${name} missing`, type: 'file' } as Issue
      const [s, d] = await Promise.all([src.text(), dst.text()])
      if (s !== d) return { detail: `${name} out of sync`, type: 'file' } as Issue
    })
  )
  return results.filter((r): r is Issue => r !== undefined)
}
const checkRootPkg = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const pkg = await readPkg(join(projectPath, 'package.json'))
  if (!pkg) return issues
  if (!pkg.private) issues.push(drift('root package.json should be private'))
  if (!pkg.packageManager) issues.push({ detail: 'packageManager field missing', type: 'missing' })
  if (!pkg['simple-git-hooks']) issues.push({ detail: 'simple-git-hooks in package.json', type: 'missing' })
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
      issues.push({ detail: entry, type: 'missing' })
  const pkg = await readPkg(join(projectPath, 'package.json'))
  if (pkg && !pkg.scripts?.action) issues.push({ detail: '"action" script missing', type: 'missing' })
  const ts = (await readJson(join(projectPath, 'tsconfig.json'))) as null | Record<string, unknown>
  if (ts) {
    if (ts.extends && ts.extends !== EXPECTED.tsconfigExtends)
      issues.push(drift('tsconfig.json should extend lintmax/tsconfig'))
    if (ts.include) issues.push(drift('root tsconfig.json should not have "include"'))
    const types = (ts.compilerOptions as Record<string, unknown> | undefined)?.types as string[] | undefined
    if (!types?.includes('bun-types')) issues.push({ detail: 'root tsconfig.json missing "bun-types"', type: 'missing' })
  }
  const v = (await readJson(join(projectPath, 'vercel.json'))) as null | Record<string, unknown>
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
const checkContent = (content: string, r: string, must: [string, string][], mustNot: [string, string][]): Issue[] => {
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
      issues.push(...checkContent(content, r, LAYOUT_REQUIRED, LAYOUT_FORBIDDEN))
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
  const [sourceResults, pkgResults] = await Promise.all([
    Promise.all(
      banned.map(async ({ ban, fix }) => {
        const files = await shell(projectPath, ban)
        if (files) return { ban, files, fix }
      })
    ),
    Promise.all(
      (await glob('**/package.json', projectPath)).map(async pkgPath => {
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
  ])
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
  if (latestLine?.includes('● Error')) return [{ detail: 'vercel deployment failed', type: 'deploy' }]
  return []
}
export {
  checkAppTsconfigs,
  checkBannedImports,
  checkCi,
  checkConfigs,
  checkDrift,
  checkForbidden,
  checkGit,
  checkLayouts,
  checkNextConfigs,
  checkPages,
  checkRootPkg,
  checkVercel
}
