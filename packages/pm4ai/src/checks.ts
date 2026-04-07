/* eslint-disable complexity */
import { $, file } from 'bun'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Issue } from './types.js'
import { getCodeCommitsSince, isCheckRunning, readCheckResult } from './check-cache.js'
import { DEFAULT_SCRIPTS, EXPECTED, FORBIDDEN_LOCKFILES, MUST_EXIST_FILES, VERBATIM_FILES } from './constants.js'
import { debug, getGhRepo, readJson, readPkg } from './utils.js'
const checkCi = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const repo = await getGhRepo(projectPath)
  if (!repo) return issues
  const ciResult =
    await $`gh run list --repo ${repo} --limit 1 --json conclusion,createdAt --jq '.[0] | "\(.conclusion) \(.createdAt)"'`
      .quiet()
      .nothrow()
  if (ciResult.exitCode !== 0) debug('command failed:', `gh run list --repo ${repo}`)
  const ciLine = ciResult.stdout.toString().trim()
  const [ciConclusion, ciTime] = ciLine.split(' ')
  if (ciConclusion === 'failure') issues.push({ detail: `failed ${ciTime ?? ''}`, type: 'ci' })
  else if (ciConclusion === 'success') issues.push({ detail: `passed ${ciTime ?? ''}`, type: 'info' })
  return issues
}
const checkGit = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  const statusResult = await $`git status --porcelain`.cwd(projectPath).quiet().nothrow()
  if (statusResult.exitCode !== 0) debug('command failed:', 'git status --porcelain')
  const statusOut = statusResult.stdout.toString().trim()
  if (statusOut) {
    const count = statusOut.split('\n').length
    issues.push({ detail: `${count} uncommitted changes`, type: 'git' })
  }
  await $`git fetch`.cwd(projectPath).quiet().nothrow()
  const behindResult = await $`git rev-list --count HEAD..@{u}`.cwd(projectPath).quiet().nothrow()
  const behind = Number.parseInt(behindResult.stdout.toString().trim(), 10)
  if (behind > 0) issues.push({ detail: `${behind} commits behind remote`, type: 'git' })
  const aheadResult = await $`git rev-list --count @{u}..HEAD`.cwd(projectPath).quiet().nothrow()
  const ahead = Number.parseInt(aheadResult.stdout.toString().trim(), 10)
  if (ahead > 0) issues.push({ detail: `${ahead} commits ahead of remote`, type: 'git' })
  return issues
}
const checkDrift = async (selfPath: string, projectPath: string): Promise<Issue[]> => {
  const names = VERBATIM_FILES
  const results = await Promise.all(
    names.map(async name => {
      const src = file(join(selfPath, name))
      const dst = file(join(projectPath, name))
      if (!(await src.exists())) return
      if (!(await dst.exists())) return { detail: `${name} missing`, type: 'file' } as Issue
      const [srcContent, dstContent] = await Promise.all([src.text(), dst.text()])
      if (srcContent !== dstContent) return { detail: `${name} out of sync`, type: 'file' } as Issue
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
    if ('include' in tsRaw)
      issues.push({
        detail: 'root tsconfig.json should not have "include" — let lintmax/tsconfig handle it',
        type: 'drift'
      })
    const compilerOptions = ('compilerOptions' in tsRaw ? tsRaw.compilerOptions : undefined) as
      | Record<string, unknown>
      | undefined
    const types = compilerOptions?.types as string[] | undefined
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
    $`rg '^// @ts-nocheck|^/\* @ts-nocheck' ${projectPath} -g '*.ts' -g '*.tsx' -g '!node_modules' -g '!readonly' -g '!.next' -l`
      .quiet()
      .nothrow()
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
      detail: `nested .gitignore: ${extraGitignores.map(f => f.replace(`${projectPath}/`, '')).join(', ')}`,
      type: 'drift'
    })
  if (postcssFiles.stdout.toString().trim()) issues.push({ detail: 'postcss.config.mjs should be .ts', type: 'drift' })
  const tsNoCheckFiles = tsNoCheck.stdout.toString().trim()
  if (tsNoCheckFiles)
    issues.push({
      detail: `@ts-nocheck in: ${tsNoCheckFiles
        .split('\n')
        .map(f => f.replace(`${projectPath}/`, ''))
        .join(', ')}`,
      type: 'forbidden'
    })
  const isLintmax = projectPath.includes('/lintmax')
  const bannedImports = [
    { ban: 'vitest', fix: 'bun:test' },
    { ban: '@jest', fix: 'bun:test' },
    { ban: 'mocha', fix: 'bun:test' },
    { ban: 'ts-node', fix: 'bun' },
    { ban: 'tsx/', fix: 'bun' },
    { ban: 'nodemon', fix: 'bun --watch' },
    { ban: 'webpack', fix: 'tsdown/turbopack' },
    { ban: 'rollup', fix: 'tsdown' },
    { ban: '"esbuild"', fix: 'tsdown' },
    { ban: '"vue"', fix: 'react' },
    { ban: '@angular', fix: 'react' },
    { ban: '"svelte"', fix: 'react' },
    { ban: '"solid-js"', fix: 'react' },
    { ban: '"express"', fix: 'elysia or next.js api routes' },
    { ban: '"fastify"', fix: 'elysia or next.js api routes' },
    { ban: '"hono"', fix: 'elysia or next.js api routes' },
    { ban: '"koa"', fix: 'elysia or next.js api routes' },
    { ban: '"remix"', fix: 'next.js' },
    { ban: '"gatsby"', fix: 'next.js' },
    { ban: '"astro"', fix: 'next.js' },
    { ban: '"vite"', fix: 'next.js + turbopack' },
    { ban: 'styled-components', fix: 'tailwind' },
    { ban: '"@emotion', fix: 'tailwind' },
    { ban: '"sass"', fix: 'tailwind' },
    { ban: '"less"', fix: 'tailwind' },
    { ban: '"stylus"', fix: 'tailwind' },
    { ban: '"@mui', fix: 'shadcn + tailwind' },
    { ban: '"@chakra-ui', fix: 'shadcn + tailwind' },
    { ban: '"@mantine', fix: 'shadcn + tailwind' },
    { ban: '"antd"', fix: 'shadcn + tailwind' },
    { ban: '"prisma"', fix: 'drizzle' },
    { ban: '"typeorm"', fix: 'drizzle' },
    { ban: '"sequelize"', fix: 'drizzle' },
    { ban: '"knex"', fix: 'drizzle' },
    { ban: '"mikro-orm"', fix: 'drizzle' },
    { ban: '"axios"', fix: 'native fetch or ky' },
    { ban: '"got"', fix: 'native fetch or ky' },
    { ban: '"superagent"', fix: 'native fetch or ky' },
    { ban: '"node-fetch"', fix: 'native fetch or ky' },
    { ban: '"joi"', fix: 'zod' },
    { ban: '"yup"', fix: 'zod' },
    { ban: '"ajv"', fix: 'zod' },
    { ban: '"moment"', fix: 'date-fns' },
    { ban: '"dayjs"', fix: 'date-fns' },
    { ban: '"redux"', fix: 'zustand or jotai' },
    { ban: '"mobx"', fix: 'zustand or jotai' },
    { ban: '"recoil"', fix: 'zustand or jotai' },
    { ban: '"valtio"', fix: 'zustand or jotai' },
    { ban: '"passport"', fix: 'better-auth' },
    { ban: '"next-auth"', fix: 'better-auth' },
    { ban: '"winston"', fix: 'logtape or consola' },
    { ban: '"pino"', fix: 'logtape or consola' },
    { ban: '"bunyan"', fix: 'logtape or consola' },
    { ban: '"react-spring"', fix: 'motion' },
    { ban: '"gsap"', fix: 'motion' },
    { ban: '"anime"', fix: 'motion' },
    { ban: '"@nestjs', fix: 'elysia or next.js' },
    { ban: '"nuxt"', fix: 'next.js' },
    { ban: '"sveltekit"', fix: 'next.js' },
    { ban: '"lodash"', fix: 'es-toolkit or native JS' },
    { ban: '"underscore"', fix: 'es-toolkit or native JS' },
    { ban: '"ramda"', fix: 'es-toolkit or native JS' },
    { ban: '"cypress"', fix: 'playwright' },
    { ban: '"puppeteer"', fix: 'playwright' },
    { ban: '"testing-library"', fix: 'bun:test + playwright' },
    { ban: '"selenium"', fix: 'playwright' },
    { ban: '"webdriver"', fix: 'playwright' },
    { ban: '"ava"', fix: 'bun:test' },
    { ban: '"tap"', fix: 'bun:test' },
    { ban: '"parcel"', fix: 'tsdown/turbopack' },
    { ban: '"preact"', fix: 'react' },
    { ban: '"qwik"', fix: 'react + next.js' },
    { ban: '"lit"', fix: 'react' },
    { ban: '"redwood"', fix: 'next.js' },
    { ban: '"adonis"', fix: 'elysia or next.js' },
    { ban: '"feathers"', fix: 'elysia or next.js' },
    { ban: 'vanilla-extract', fix: 'tailwind' },
    { ban: '"linaria"', fix: 'tailwind' },
    { ban: '"xstate"', fix: 'zustand or jotai' },
    { ban: '"effector"', fix: 'zustand or jotai' },
    { ban: '"valibot"', fix: 'zod' },
    { ban: '"typebox"', fix: 'zod' },
    { ban: '"luxon"', fix: 'date-fns' },
    { ban: '"mongoose"', fix: 'drizzle' },
    { ban: '"lucia"', fix: 'better-auth' },
    { ban: '"signale"', fix: 'logtape or consola' },
    { ban: '"deno"', fix: 'bun' },
    { ban: '"@radix-ui', fix: 'cnsync (readonly/ui)' },
    { ban: '"graphql"', fix: 'oRPC' },
    { ban: '"@trpc', fix: 'oRPC' },
    { ban: '"socket.io"', fix: 'native WebSocket or Unix socket' },
    { ban: '"formik"', fix: 'tanstack-form' },
    { ban: '"react-hook-form"', fix: 'tanstack-form' },
    { ban: '"storybook"', fix: 'not needed with shadcn' },
    { ban: '"pm2"', fix: 'bun native' },
    { ban: '"dotenv"', fix: 'bun native .env loading' },
    { ban: '"commander"', fix: 'bun process.argv' },
    { ban: '"yargs"', fix: 'bun process.argv' },
    { ban: '"meow"', fix: 'bun process.argv' },
    { ban: '"chalk"', fix: 'ink or native ANSI' },
    { ban: '"picocolors"', fix: 'ink or native ANSI' },
    { ban: '"colorette"', fix: 'ink or native ANSI' },
    { ban: '"fast-glob"', fix: 'import { Glob } from bun' },
    { ban: '"glob"', fix: 'import { Glob } from bun' },
    { ban: '"fs-extra"', fix: 'native node:fs' },
    { ban: '"cross-env"', fix: 'bun handles env natively' },
    { ban: '"concurrently"', fix: 'turbo' },
    { ban: '"npm-run-all"', fix: 'turbo' },
    { ban: '"husky"', fix: 'simple-git-hooks' },
    { ban: '"lint-staged"', fix: 'lintmax' },
    { ban: '"uuid"', fix: 'crypto.randomUUID()' },
    { ban: '"nanoid"', fix: 'crypto.randomUUID()' },
    { ban: '"cuid"', fix: 'crypto.randomUUID()' },
    { ban: '"bcrypt"', fix: 'Bun.password' },
    { ban: '"bcryptjs"', fix: 'Bun.password' },
    { ban: '"jsonwebtoken"', fix: 'better-auth' },
    { ban: '"jose"', fix: 'better-auth' },
    { ban: '"ws"', fix: 'bun native WebSocket' },
    { ban: '"nodemailer"', fix: 'native fetch to email API' },
    { ban: '"node-cron"', fix: 'vercel cron or bun native' },
    { ban: '"cron"', fix: 'vercel cron or bun native' },
    { ban: '"bull"', fix: 'vercel queues or bun native' },
    { ban: '"bullmq"', fix: 'vercel queues or bun native' },
    { ban: '"sharp"', fix: 'next/image optimization' },
    { ban: '"jimp"', fix: 'next/image optimization' },
    { ban: '"react-icons"', fix: 'lucide-react (from shadcn)' },
    { ban: '"react-select"', fix: 'shadcn combobox' },
    { ban: '"react-modal"', fix: 'shadcn dialog' },
    { ban: '"react-toastify"', fix: 'shadcn sonner' },
    { ban: '"react-hot-toast"', fix: 'shadcn sonner' },
    { ban: '"react-dropzone"', fix: 'shadcn or native input' },
    { ban: '"react-helmet"', fix: 'next.js metadata' },
    { ban: '"react-router"', fix: 'next.js routing' },
    { ban: '"swr"', fix: 'tanstack-query' },
    { ban: '"clsx"', fix: 'cn() from shadcn' },
    { ban: '"tailwind-merge"', fix: 'cn() from shadcn' },
    { ban: '"classnames"', fix: 'cn() from shadcn' },
    { ban: '"cors"', fix: 'not needed with elysia/next.js' },
    { ban: '"helmet"', fix: 'not needed with elysia/next.js' },
    { ban: '"body-parser"', fix: 'not needed with elysia/next.js' },
    { ban: '"morgan"', fix: 'not needed with elysia/next.js' },
    { ban: '"cookie-parser"', fix: 'not needed with elysia/next.js' },
    { ban: '"multer"', fix: 'not needed with elysia/next.js' },
    { ban: '"inquirer"', fix: 'ink' },
    { ban: '"prompts"', fix: 'ink' },
    { ban: '"enquirer"', fix: 'ink' },
    { ban: '"ora"', fix: 'ink-spinner' },
    { ban: '"boxen"', fix: 'ink Box' },
    { ban: '"better-sqlite3"', fix: 'bun native SQLite' },
    { ban: '"cheerio"', fix: 'playwright' },
    { ban: '"marked"', fix: 'remark/rehype (unified)' },
    { ban: '"markdown-it"', fix: 'remark/rehype (unified)' },
    ...(isLintmax
      ? []
      : [
          { ban: '"prettier"', fix: 'lintmax' },
          { ban: '"eslint"', fix: 'lintmax' },
          { ban: '"oxlint"', fix: 'lintmax' },
          { ban: '"@biomejs', fix: 'lintmax' }
        ])
  ]
  const banResults = await Promise.all(
    bannedImports.map(async ({ ban, fix }) => {
      const result =
        await $`rg ${ban} ${projectPath} -g '*.ts' -g '*.tsx' -g '*.json' -g '!node_modules' -g '!readonly' -g '!.next' -g '!dist' -l`
          .quiet()
          .nothrow()
      const files = result.stdout.toString().trim()
      if (files) return { ban, files, fix }
    })
  )
  for (const r of banResults)
    if (r)
      issues.push({
        detail: `${r.ban} banned, use ${r.fix}: ${r.files
          .split('\n')
          .map(f => f.replace(`${projectPath}/`, ''))
          .join(', ')}`,
        type: 'forbidden'
      })
  return issues
}
const checkVercel = async (projectPath: string): Promise<Issue[]> => {
  const issues: Issue[] = []
  if (!existsSync(join(projectPath, '.vercel'))) return issues
  const result = await $`bunx vercel@latest ls`.cwd(projectPath).quiet().nothrow()
  if (result.exitCode !== 0) debug('command failed:', 'bunx vercel@latest ls')
  const out = result.stdout.toString().trim()
  const latestLine = out.split('\n').find(l => l.includes('●'))
  if (latestLine?.includes('● Error')) issues.push({ detail: 'vercel deployment failed', type: 'deploy' })
  return issues
}
const checkLint = (projectPath: string): Issue[] => {
  if (isCheckRunning(projectPath)) return [{ detail: 'running...', type: 'check' }]
  const result = readCheckResult(projectPath)
  if (!result) return [{ detail: 'never run', type: 'check' }]
  const ms = Date.now() - new Date(result.at).getTime()
  const mins = Math.floor(ms / 60_000)
  const age =
    mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`
  const commitsBehind = getCodeCommitsSince(projectPath, result.commit)
  const freshness = commitsBehind === 0 ? '(current)' : commitsBehind > 0 ? `(before ${commitsBehind} commits)` : ''
  if (result.pass) return [{ detail: `passed ${age} ${freshness}`, type: 'check' }]
  return [{ detail: `failed ${age} ${freshness}, ${result.violations} violations`, type: 'check' }]
}
export { checkCi, checkConfigs, checkDrift, checkForbidden, checkGit, checkLint, checkRootPkg, checkVercel }
