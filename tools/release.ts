#!/usr/bin/env bun
/* eslint-disable no-console */
import { $, file, Glob } from 'bun'
import { dirname, join } from 'node:path'
const nameVer = (p: { name: string; version: string }): string => `${p.name}@${p.version}`
interface Pkg {
  name?: string
  private?: boolean
  version?: string
  workspaces?: string[]
}
interface Target {
  dir: string
  name: string
  onNpm: boolean
  published: boolean
  version: string
}
/** Only a 404 means the package is genuinely not on npm; every other npm failure is the registry declining to answer. */
const notFoundRe = /E404|404 Not Found/u
const toVersionList = (parsed: unknown): string[] => {
  if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string')
  if (typeof parsed === 'string') return [parsed]
  return []
}
const readPkg = async (path: string): Promise<Pkg> => {
  const parsed: unknown = await file(path)
    .json()
    .catch(() => ({}))
  return typeof parsed === 'object' && parsed !== null ? parsed : {}
}
const root = process.cwd()
const rootPkg = await readPkg(join(root, 'package.json'))
const globs = rootPkg.workspaces ?? ['packages/*']
const scanned = await Promise.all(
  globs.map(async g =>
    (await Array.fromAsync(new Glob(`${g}/package.json`).scan({ cwd: root }))).map(rel => join(root, rel))
  )
)
const rootCandidate = rootPkg.name ? [join(root, 'package.json')] : []
const paths = [...rootCandidate, ...scanned.flat()]
const pkgs = await Promise.all(
  paths.map(async path => ({
    path,
    pkg: await readPkg(path)
  }))
)
const resolve = async (path: string, pkg: Pkg): Promise<Target | undefined> => {
  if (!(pkg.name && pkg.version) || pkg.private) return undefined
  const view = await $`npm view ${pkg.name} versions --json`.quiet().nothrow()
  if (view.exitCode !== 0 && !notFoundRe.test(view.stderr.toString()))
    throw new Error(
      `npm view ${pkg.name} failed, so whether it needs publishing is unknown: ${view.stderr.toString().trim()}`
    )
  const all = toVersionList(view.exitCode === 0 ? JSON.parse(view.stdout.toString().trim() || '[]') : [])
  return {
    dir: dirname(path),
    name: pkg.name,
    onNpm: view.exitCode === 0,
    published: all.includes(pkg.version),
    version: pkg.version
  }
}
const publishOne = async (t: Target): Promise<Target & { ok: boolean }> => {
  const pub = await $`bun publish --access public`.cwd(t.dir).nothrow()
  if (pub.exitCode === 0) return { ...t, ok: true }
  const recheck = await $`npm view ${t.name}@${t.version} version`.quiet().nothrow()
  return { ...t, ok: recheck.exitCode === 0 && recheck.stdout.toString().trim().length > 0 }
}
const staleTags = async (tag: string): Promise<string[]> => {
  const ls = await $`git ls-remote --tags origin`.quiet().nothrow()
  if (ls.exitCode !== 0)
    throw new Error(`cannot list remote tags, so whether older ones remain is unknown: ${ls.stderr.toString().trim()}`)
  const names = ls.stdout
    .toString()
    .split('\n')
    .map(line => line.split('/').at(-1) ?? '')
    .filter(t => t && t !== tag && !t.endsWith('^{}'))
  return [...new Set(names)]
}
const tagAndRelease = async (results: Target[]): Promise<{ code: number; tag: string }> => {
  const first = results[0]
  const tag = `v${first?.version ?? '0.0.0'}`
  const tagged = await $`git tag ${tag}`.nothrow()
  const pushed = tagged.exitCode === 0 ? await $`git push origin ${tag}`.nothrow() : tagged
  const released =
    pushed.exitCode === 0 ? await $`gh release create ${tag} --title ${tag} --generate-notes`.nothrow() : pushed
  if (released.exitCode === 0) return { code: 0, tag }
  console.error(
    `published ${results.map(nameVer).join(', ')} but ${tag} did not land: ${released.stderr.toString().trim()}`
  )
  return { code: 1, tag }
}
const pruneStaleTags = async (tag: string): Promise<number> => {
  await Promise.all(
    (await staleTags(tag)).map(async t => {
      await $`gh release delete ${t} --yes --cleanup-tag`.nothrow()
      await $`git push origin :refs/tags/${t}`.nothrow()
    })
  )
  const survivors = await staleTags(tag)
  if (survivors.length === 0) return 0
  console.error(`released ${tag} but older tags remain on the remote: ${survivors.join(', ')}`)
  return 1
}
const releaseTag = async (results: Target[]): Promise<number> => {
  const { code, tag } = await tagAndRelease(results)
  if (code !== 0) return code
  const pruned = await pruneStaleTags(tag)
  if (pruned !== 0) return pruned
  console.log(`released: ${results.map(nameVer).join(', ')}`)
  return 0
}
const publishAll = async (toPublish: Target[]): Promise<number> => {
  const results = await Promise.all(toPublish.map(publishOne))
  const failed = results.filter(r => !r.ok)
  if (failed.length > 0) {
    console.error(`publish failed: ${failed.map(nameVer).join(', ')}`)
    return 1
  }
  const code = await releaseTag(results)
  return code
}
const selectToPublish = (resolved: Target[]): Target[] | undefined => {
  const onNpm = resolved.filter(t => t.onNpm)
  if (onNpm.length === 0) {
    console.log('no publishable package on npm (new packages are published manually once, then auto-release takes over)')
    return undefined
  }
  const toPublish = onNpm.filter(t => !t.published)
  if (toPublish.length > 0) return toPublish
  console.log(`already published: ${onNpm.map(nameVer).join(', ')}`)
  return undefined
}
const main = async (): Promise<number> => {
  const resolved = (await Promise.all(pkgs.map(async ({ path, pkg }) => resolve(path, pkg)))).filter(
    (t): t is Target => t !== undefined
  )
  const toPublish = selectToPublish(resolved)
  if (toPublish === undefined) return 0
  const code = await publishAll(toPublish)
  return code
}
process.exitCode = await main()
