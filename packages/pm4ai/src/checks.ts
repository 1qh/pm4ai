/* eslint-disable complexity */
import { $, file } from 'bun'
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
const findFiles = async (pattern: string, projectPath: string, extra = ''): Promise<string[]> => {
  const cmd = extra ? `find ${projectPath} ${pattern} ${extra}` : `find ${projectPath} ${pattern}`
  const result = await $`sh -c ${cmd}`.quiet().nothrow()
  return result.stdout.toString().trim().split('\n').filter(Boolean)
}
const rgFiles = async (
  pattern: string,
  projectPath: string,
  globs: string[] = ['-g', '*.ts', '-g', '*.tsx']
): Promise<string> => {
  const result = await $`rg ${pattern} ${projectPath} ${globs} ${RG_EXCLUDE} -l`.quiet().nothrow()
  return result.stdout.toString().trim()
}
const rel = (fullPath: string, projectPath: string) => fullPath.replace(`${projectPath}/`, '')
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
  if (!pkg.private) issues.push({ detail: 'root package.json should be private', type: 'drift' })
  if (!pkg.packageManager) issues.push({ detail: 'packageManager field missing', type: 'missing' })
  if (!pkg['simple-git-hooks']) issues.push({ detail: 'simple-git-hooks in package.json', type: 'missing' })
  else if (pkg['simple-git-hooks']['pre-commit'] !== EXPECTED.preCommit)
    issues.push({ detail: `pre-commit should be "${EXPECTED.preCommit}"`, type: 'drift' })
  if (pkg.scripts?.prepare !== DEFAULT_SCRIPTS.prepare)
    issues.push({ detail: `prepare should be "${DEFAULT_SCRIPTS.prepare}"`, type: 'drift' })
  if (!pkg.scripts?.postinstall?.includes('sherif'))
    issues.push({ detail: `postinstall should include "${DEFAULT_SCRIPTS.postinstall}"`, type: 'drift' })
  if (pkg.scripts?.clean && !pkg.scripts.clean.startsWith(DEFAULT_SCRIPTS.clean))
    issues.push({ detail: `clean should start with "${DEFAULT_SCRIPTS.clean}"`, type: 'drift' })
  return issues
}
const checkConfigs = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const isGitHub = Boolean(await getGhRepo(projectPath))
  for (const entry of MUST_EXIST_FILES)
    if (!((entry.includes('.github/') && !isGitHub) || existsSync(join(projectPath, entry))))
      issues.push({ detail: entry, type: 'missing' })
  const pkg = await readPkg(join(projectPath, 'package.json'))
  if (pkg && !pkg.scripts?.action) issues.push({ detail: '"action" script missing in root package.json', type: 'missing' })
  const tsRaw = await readJson(join(projectPath, 'tsconfig.json'))
  if (tsRaw && typeof tsRaw === 'object' && !Array.isArray(tsRaw)) {
    const ext = 'extends' in tsRaw ? String(tsRaw.extends) : ''
    if (ext && ext !== EXPECTED.tsconfigExtends)
      issues.push({ detail: 'tsconfig.json should extend lintmax/tsconfig', type: 'drift' })
    if ('include' in tsRaw) issues.push({ detail: 'root tsconfig.json should not have "include"', type: 'drift' })
    const types = (('compilerOptions' in tsRaw ? tsRaw.compilerOptions : undefined) as Record<string, unknown> | undefined)
      ?.types as string[] | undefined
    if (!types?.includes('bun-types'))
      issues.push({ detail: 'root tsconfig.json missing "bun-types" in compilerOptions.types', type: 'missing' })
  }
  const vRaw = await readJson(join(projectPath, 'vercel.json'))
  if (vRaw && typeof vRaw === 'object' && !Array.isArray(vRaw)) {
    const cmd = 'installCommand' in vRaw ? String(vRaw.installCommand) : ''
    if (cmd && cmd !== EXPECTED.vercelInstall)
      issues.push({ detail: 'vercel.json installCommand should be "bun i"', type: 'drift' })
  }
  return issues
}
const checkLayouts = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const files = await findFiles(
    "-name 'layout.tsx' -path '*/app/layout.tsx'",
    projectPath,
    "-not -path '*/node_modules/*' -not -path '*/readonly/*' -not -path '*/.next/*' -not -path '*/templates/*'"
  )
  await Promise.all(
    files.map(async layoutFile => {
      const content = await file(layoutFile).text()
      const r = rel(layoutFile, projectPath)
      if (!content.includes('<html')) return
      const required: [string, string][] = [
        ['suppressHydrationWarning', 'missing suppressHydrationWarning on <html>'],
        ['antialiased', 'missing antialiased on <body>'],
        ['tracking-[-0.02em]', 'missing tracking-[-0.02em] on <html>'],
        ['min-h-screen', 'missing min-h-screen on <body>'],
        ['font-sans', 'missing font-sans on <html>'],
        ['Metadata', 'missing metadata export']
      ]
      for (const [check, msg] of required)
        if (!content.includes(check)) issues.push({ detail: `${msg}: ${r}`, type: 'drift' })
      const forbidden: [string, string][] = [
        ['RootLayout', 'use Layout not RootLayout'],
        ['export default function', 'use arrow function + export default Layout']
      ]
      for (const [check, msg] of forbidden)
        if (content.includes(check)) issues.push({ detail: `${msg}: ${r}`, type: 'drift' })
      if (content.includes("'./globals.css'") || content.includes('"./globals.css"'))
        issues.push({ detail: `use global.css not globals.css: ${r}`, type: 'drift' })
      const dir = layoutFile.replace('/layout.tsx', '')
      if (!existsSync(join(dir, 'fonts.ts')))
        issues.push({ detail: `missing fonts.ts next to layout: ${r}`, type: 'drift' })
      if (content.includes('Providers') && !existsSync(join(dir, 'providers.tsx')))
        issues.push({ detail: `providers.tsx should be next to layout: ${r}`, type: 'drift' })
      const providerMatches = content.match(providerJsxRe) ?? []
      const hasClientProvider = providerMatches.some(m => !serverProviderRe.test(m))
      if (hasClientProvider && !providerImportRe.test(content))
        issues.push({ detail: `Provider in layout, move to providers.tsx: ${r}`, type: 'drift' })
    })
  )
  return issues
}
const checkPages = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const files = await findFiles(
    "-name 'page.tsx' -path '*/app/*'",
    projectPath,
    "-not -path '*/node_modules/*' -not -path '*/readonly/*' -not -path '*/.next/*' -not -path '*/templates/*'"
  )
  await Promise.all(
    files.map(async pageFile => {
      const content = await file(pageFile).text()
      if (content.includes('export default function'))
        issues.push({ detail: `use arrow function + export default Page: ${rel(pageFile, projectPath)}`, type: 'drift' })
    })
  )
  return issues
}
const checkNextConfigs = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const configs = await findFiles(
    "-name 'next.config.ts'",
    projectPath,
    "-not -path '*/node_modules/*' -not -path '*/readonly/*' -not -path '*/.next/*'"
  )
  await Promise.all(
    configs.map(async configFile => {
      const content = await file(configFile).text()
      if (!(content.includes('reactStrictMode') || content.includes('createNextConfig')))
        issues.push({ detail: `missing reactStrictMode in ${rel(configFile, projectPath)}`, type: 'drift' })
    })
  )
  const redundant = await findFiles(
    "-name 'postcss.config.*' -path '*/apps/*'",
    projectPath,
    "-not -path '*/node_modules/*' -not -path '*/readonly/*'"
  )
  for (const f of redundant) issues.push({ detail: `redundant ${rel(f, projectPath)}, remove it`, type: 'drift' })
  return issues
}
const checkAppTsconfigs = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const files = await findFiles("-path '*/apps/*/tsconfig.json'", projectPath, "-not -path '*/node_modules/*'")
  await Promise.all(
    files.map(async tsconfigFile => {
      const content = await file(tsconfigFile).text()
      const r = rel(tsconfigFile, projectPath)
      if (!content.includes('"extends"')) issues.push({ detail: `${r} should extend lintmax/tsconfig`, type: 'drift' })
      if (content.includes('"include"')) issues.push({ detail: `${r} should not have "include"`, type: 'drift' })
    })
  )
  return issues
}
const checkForbidden = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  for (const f of FORBIDDEN_LOCKFILES)
    if (existsSync(join(projectPath, f))) issues.push({ detail: `${f} found, use bun only`, type: 'forbidden' })
  const [bunLockTracked, nestedGitignores, postcssFiles, tsNoCheck] = await Promise.all([
    $`git ls-files bun.lock`.cwd(projectPath).quiet().nothrow(),
    $`find ${projectPath} -name .gitignore -not -path '*/node_modules/*' -not -path '*/.git/*'`.quiet().nothrow(),
    $`find ${projectPath} -name 'postcss.config.mjs' -not -path '*/node_modules/*' -not -path '*/readonly/*'`
      .quiet()
      .nothrow(),
    $`rg '^// @ts-nocheck|^/\* @ts-nocheck' ${projectPath} -g '*.ts' -g '*.tsx' ${RG_EXCLUDE} -l`.quiet().nothrow()
  ])
  if (bunLockTracked.stdout.toString().trim())
    issues.push({ detail: 'bun.lock tracked in git, should be gitignored', type: 'forbidden' })
  const extraGitignores = nestedGitignores.stdout
    .toString()
    .trim()
    .split('\n')
    .filter(f => f && f !== join(projectPath, '.gitignore'))
  if (extraGitignores.length > 0)
    issues.push({
      detail: `nested .gitignore: ${extraGitignores.map(f => rel(f, projectPath)).join(', ')}`,
      type: 'drift'
    })
  if (postcssFiles.stdout.toString().trim()) issues.push({ detail: 'postcss.config.mjs should be .ts', type: 'drift' })
  const tsNoCheckFiles = tsNoCheck.stdout.toString().trim()
  if (tsNoCheckFiles)
    issues.push({
      detail: `@ts-nocheck in: ${tsNoCheckFiles
        .split('\n')
        .map(f => rel(f, projectPath))
        .join(', ')}`,
      type: 'forbidden'
    })
  return issues
}
const checkBannedImports = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const isLintmax = projectPath.includes('/lintmax')
  const bannedImports = [...ALL_BANNED, ...(isLintmax ? [] : LINTMAX_ONLY)].filter(b => !TEMPORARY.has(b.ban))
  const banResults = await Promise.all(
    bannedImports.map(async ({ ban, fix }) => {
      const files = await rgFiles(ban, projectPath)
      if (files) return { ban, files, fix }
    })
  )
  const pkgJsonFiles = await findFiles(
    "-name 'package.json'",
    projectPath,
    "-not -path '*/node_modules/*' -not -path '*/readonly/*'"
  )
  const pkgBanResults = await Promise.all(
    pkgJsonFiles.map(async pkgPath => {
      const raw = await readPkg(pkgPath)
      if (!raw) return []
      const depNames = Object.keys({ ...raw.dependencies, ...raw.devDependencies, ...raw.peerDependencies })
      const matches: { ban: string; files: string; fix: string }[] = []
      for (const { ban, fix } of bannedImports) {
        const cleanBan = ban.replaceAll(/^"|"$/gu, '')
        const isPrefix = !ban.endsWith('"')
        if (depNames.some(d => (isPrefix ? d.startsWith(cleanBan) : d === cleanBan)))
          matches.push({ ban, files: pkgPath, fix })
      }
      return matches
    })
  )
  for (const matches of pkgBanResults) for (const m of matches) banResults.push(m)
  for (const r of banResults)
    if (r)
      issues.push({
        detail: `${r.ban} banned, use ${r.fix}: ${r.files
          .split('\n')
          .map(f => rel(f, projectPath))
          .join(', ')}`,
        type: 'forbidden'
      })
  const bunGlobalResult =
    await $`rg 'Bun\.\w+' ${projectPath} -g '*.ts' -g '*.tsx' -g '!*.d.ts' ${RG_EXCLUDE} -o --no-filename`
      .quiet()
      .nothrow()
  const bunGlobalMatches = bunGlobalResult.stdout.toString().trim()
  if (bunGlobalMatches) {
    const fixable = [...new Set(bunGlobalMatches.split('\n'))].filter(g => BUN_GLOBALS[g])
    if (fixable.length > 0)
      issues.push({
        detail: `use named imports: ${fixable.map(g => `${g} → ${BUN_GLOBALS[g]}`).join(', ')}`,
        type: 'forbidden'
      })
  }
  const deepUiFiles = await rgFiles(`${UI_PACKAGE_NAME}/lib/`, projectPath)
  if (deepUiFiles)
    issues.push({
      detail: `use import { cn } from '${UI_PACKAGE_NAME}', not deep paths: ${deepUiFiles
        .split('\n')
        .map(f => rel(f, projectPath))
        .join(', ')}`,
      type: 'forbidden'
    })
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
