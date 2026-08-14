/* eslint-disable no-console */
import { $, file, write } from 'bun'
import { access, cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { discover } from './discover.js'
import { syncClaudeMd } from './sync.js'
import { getBunVersion, isInsideExistingRepo, isNestedInRepo } from './utils.js'

const SKIP = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vercel',
  '_lintmax_dummy.ts',
  'bun.lock',
  'CLAUDE.md',
  'dist',
  'node_modules',
  'prompts',
  'README.md',
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
const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
const copyTree = async (src: string, dst: string, skipExtra?: Set<string>): Promise<void> => {
  const entries = await readdir(src)
  await Promise.all(
    entries
      .filter(entry => !(SKIP.has(entry) || skipExtra?.has(entry)))
      .map(async entry => {
        const s = join(src, entry)
        const d = join(dst, entry)
        const isDir = (await stat(s)).isDirectory()
        if (isDir) {
          await mkdir(d, { recursive: true })
          await copyTree(s, d)
        } else await cp(s, d)
      })
  )
}
const copyTemplateDir = async (tplDir: string, dstDir: string, projectName: string): Promise<void> => {
  const entries = await readdir(tplDir)
  await Promise.all(
    entries.map(async entry => {
      const s = join(tplDir, entry)
      const d = join(dstDir, entry)
      const isDir = (await stat(s)).isDirectory()
      if (isDir) {
        await mkdir(d, { recursive: true })
        await copyTemplateDir(s, d, projectName)
      } else {
        const content = await file(s).text()
        await mkdir(dirname(d), { recursive: true })
        await write(d, content.replaceAll('pkgname', projectName))
      }
    })
  )
}
const patchFile = async (path: string, replacements: [string, string][]) => {
  if (!(await pathExists(path))) return
  let content = await file(path).text()
  for (const [from, to] of replacements) content = content.replaceAll(from, to)
  await write(path, content)
}
const templateDir = join(dirname(new URL(import.meta.url).pathname), 'templates')
const init = async (name: string) => {
  const projectName = basename(resolve(process.cwd(), name))
  const dir = resolve(process.cwd(), name)
  if (await pathExists(dir)) {
    console.log(`${dir} already exists`)
    process.exitCode = 1
    return
  }
  if (await isInsideExistingRepo(dir)) {
    console.log(`${dir} is inside an existing git repository — refusing to scaffold`)
    process.exitCode = 1
    return
  }
  const { self } = await discover()
  const src = self.path
  console.log(`scaffolding ${projectName} from ${src}...`)
  await mkdir(dir, { recursive: true })
  await copyTree(src, dir, new Set(['packages']))
  await Promise.all(REMOVE_PATHS.map(async p => rm(join(dir, p), { force: true, recursive: true })))
  await rm(join(dir, 'packages'), { force: true, recursive: true })
  await rm(join(dir, 'apps', 'docs', 'content', 'rules'), { force: true, recursive: true })
  await mkdir(join(dir, 'apps', 'docs', 'content', 'docs'), { recursive: true })
  await Promise.all([
    copyTemplateDir(join(templateDir, 'cli'), join(dir, 'packages', 'cli'), projectName),
    copyTemplateDir(join(templateDir, 'lib'), join(dir, 'packages', 'lib'), projectName),
    copyTemplateDir(join(templateDir, 'web'), join(dir, 'apps', 'web'), projectName),
    copyTemplateDir(join(templateDir, 'docs'), join(dir, 'apps', 'docs'), projectName)
  ])
  const bunVersion = await getBunVersion()
  const rootPkgRaw = await file(join(templateDir, 'root-package.txt')).text()
  const rootPkgText = rootPkgRaw
    .replace('__PACKAGE_MANAGER__', `bun@${bunVersion}`)
    .replace('pkgname', `${projectName}-workspace`)
  await Promise.all([
    write(join(dir, 'package.json'), rootPkgText),
    patchFile(join(dir, 'apps', 'docs', 'src', 'lib', 'shared.ts'), [['pm4ai', projectName]]),
    patchFile(join(dir, 'apps', 'docs', 'src', 'lib', 'layout.shared.tsx'), [['pm4ai', projectName]]),
    patchFile(join(dir, 'apps', 'web', 'src', 'app', 'layout.tsx'), [['pm4ai dashboard', projectName]])
  ])
  await syncClaudeMd(src, dir)
  const bookInstall = join(homedir(), 'book', 'install.sh')
  if (await pathExists(bookInstall)) await $`sh ${bookInstall} ${dir}`.quiet().nothrow()
  if (await isNestedInRepo(dir)) {
    console.log(`${dir} is inside an existing git repository — refusing to run git init`)
    process.exitCode = 1
    return
  }
  await $`git init`.cwd(dir).quiet()
  await $`git add -A`.cwd(dir).quiet()
  await $`git -c user.name=pm4ai -c user.email=pm4ai commit -m "init: scaffold from pm4ai"`.cwd(dir).quiet().nothrow()
  console.log(`\ncreated ${projectName}/`)
  console.log(`\n  cd ${projectName}`)
  console.log('  bun i')
  console.log('  bun dev')
}
export { init }
