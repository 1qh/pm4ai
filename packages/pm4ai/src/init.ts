/* eslint-disable no-console */
import { $, file, write } from 'bun'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { discover } from './discover.js'
import { getBunVersion } from './utils.js'
const SKIP = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vercel',
  'bun.lock',
  'CLAUDE.md',
  'dist',
  'LEARNING.md',
  'node_modules',
  'PLAN.md',
  'PROGRESS.md',
  'prompts',
  'README.md',
  'RULES.md',
  'vercel.json'
])
const REMOVE_PATHS = [
  'apps/web/src/lib/router.ts',
  'apps/web/src/lib/socket.ts',
  'apps/web/src/lib/auth.ts',
  'apps/web/src/lib/client.ts',
  'apps/web/src/app/api',
  'apps/web/src/app/auth',
  'apps/web/src/tests',
  'apps/docs/src/app/llms-full.txt',
  'apps/docs/src/app/llms.txt',
  'apps/docs/src/app/api'
]
const copyTree = (src: string, dst: string, skipExtra?: Set<string>) => {
  for (const entry of readdirSync(src))
    if (!(SKIP.has(entry) || skipExtra?.has(entry))) {
      const s = join(src, entry)
      const d = join(dst, entry)
      if (statSync(s).isDirectory()) {
        mkdirSync(d, { recursive: true })
        copyTree(s, d)
      } else cpSync(s, d)
    }
}
const copyTemplateDir = async (tplDir: string, dstDir: string, projectName: string): Promise<void> => {
  await Promise.all(
    readdirSync(tplDir).map(async entry => {
      const s = join(tplDir, entry)
      const d = join(dstDir, entry)
      if (statSync(s).isDirectory()) {
        mkdirSync(d, { recursive: true })
        await copyTemplateDir(s, d, projectName)
      } else {
        const content = await file(s).text()
        mkdirSync(dirname(d), { recursive: true })
        await write(d, content.replaceAll('__NAME__', projectName))
      }
    })
  )
}
const patchFile = async (path: string, replacements: [string, string][]) => {
  if (!existsSync(path)) return
  let content = await file(path).text()
  for (const [from, to] of replacements) content = content.replaceAll(from, to)
  await write(path, content)
}
const writeJson = async (path: string, obj: unknown) => write(path, `${JSON.stringify(obj, null, 2)}\n`)
const omit = (obj: Record<string, string>, keys: string[]) => {
  const exclude = new Set(keys)
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !exclude.has(k)))
}
const templateDir = join(dirname(new URL(import.meta.url).pathname), 'templates')
const init = async (name: string) => {
  const projectName = basename(resolve(process.cwd(), name))
  const dir = resolve(process.cwd(), name)
  if (existsSync(dir)) {
    console.log(`${dir} already exists`)
    return
  }
  const { self } = await discover()
  const src = self.path
  console.log(`scaffolding ${projectName} from ${src}...`)
  mkdirSync(dir, { recursive: true })
  copyTree(src, dir, new Set(['packages']))
  mkdirSync(join(dir, 'packages'), { recursive: true })
  copyTree(join(src, 'packages', 'lib'), join(dir, 'packages', 'lib'))
  for (const p of REMOVE_PATHS) rmSync(join(dir, p), { force: true, recursive: true })
  rmSync(join(dir, 'apps', 'docs', 'content', 'rules'), { force: true, recursive: true })
  mkdirSync(join(dir, 'apps', 'docs', 'content', 'docs'), { recursive: true })
  await Promise.all([
    copyTemplateDir(join(templateDir, 'cli'), join(dir, 'packages', 'cli'), projectName),
    copyTemplateDir(join(templateDir, 'web'), join(dir, 'apps', 'web'), projectName),
    copyTemplateDir(join(templateDir, 'docs'), join(dir, 'apps', 'docs'), projectName)
  ])
  const bunVersion = await getBunVersion()
  const rootPkg = (await file(join(src, 'package.json')).json()) as Record<string, unknown>
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete rootPkg.name
  rootPkg.packageManager = `bun@${bunVersion}`
  rootPkg.devDependencies = omit(rootPkg.devDependencies as Record<string, string>, ['@playwright/test', '@types/mdx'])
  const webPkg = (await file(join(src, 'apps', 'web', 'package.json')).json()) as Record<string, unknown>
  webPkg.dependencies = omit((webPkg.dependencies ?? {}) as Record<string, string>, [
    '@orpc/client',
    '@orpc/react-query',
    '@orpc/server',
    '@tanstack/react-query',
    'pm4ai',
    'zod'
  ])
  const docsPkg = (await file(join(src, 'apps', 'docs', 'package.json')).json()) as Record<string, unknown>
  docsPkg.dependencies = omit((docsPkg.dependencies ?? {}) as Record<string, string>, ['pm4ai'])
  const libPkg = (await file(join(src, 'packages', 'lib', 'package.json')).json()) as Record<string, unknown>
  libPkg.name = `@${projectName}/lib`
  await Promise.all([
    writeJson(join(dir, 'package.json'), rootPkg),
    writeJson(join(dir, 'apps', 'web', 'package.json'), webPkg),
    writeJson(join(dir, 'apps', 'docs', 'package.json'), docsPkg),
    writeJson(join(dir, 'packages', 'lib', 'package.json'), libPkg),
    patchFile(join(dir, 'apps', 'docs', 'src', 'lib', 'shared.ts'), [['pm4ai', projectName]]),
    patchFile(join(dir, 'apps', 'docs', 'src', 'lib', 'layout.shared.tsx'), [['pm4ai', projectName]]),
    patchFile(join(dir, 'apps', 'web', 'src', 'app', 'layout.tsx'), [['pm4ai dashboard', projectName]])
  ])
  await $`git init`.cwd(dir).quiet()
  await $`git add -A`.cwd(dir).quiet()
  await $`git commit -m "init: scaffold from pm4ai"`.cwd(dir).quiet()
  console.log(`\ncreated ${projectName}/`)
  console.log(`\n  cd ${projectName}`)
  console.log('  bun i')
  console.log('  bun dev')
}
export { init }
