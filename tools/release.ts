#!/usr/bin/env bun
/* eslint-disable no-console -- release diagnostics are CLI output */
import { file, Glob, spawn } from 'bun'
import { dirname, join } from 'node:path'
interface CommandResult {
  exitCode: number
  stderr: string
  stdout: string
}
const runCommand = async (cmd: string[], cwd = process.cwd(), timeout = 60_000): Promise<CommandResult> => {
  const proc = spawn(cmd, {
    cwd,
    // biome-ignore lint/style/noProcessEnv: release subprocesses inherit the caller's npm credentials and PATH
    env: process.env,
    stderr: 'pipe',
    stdin: 'ignore',
    stdout: 'pipe',
    timeout
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ])
  return { exitCode, stderr, stdout }
}
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
  if (pkg.name === undefined || pkg.name === '' || pkg.version === undefined || pkg.version === '' || pkg.private)
    return undefined
  const view = await runCommand(['npm', 'view', pkg.name, 'versions', '--json'])
  if (view.exitCode !== 0 && !notFoundRe.test(view.stderr))
    throw new Error(`npm view ${pkg.name} failed, so whether it needs publishing is unknown: ${view.stderr.trim()}`)
  const all = toVersionList(view.exitCode === 0 ? JSON.parse(view.stdout.trim() || '[]') : [])
  return {
    dir: dirname(path),
    name: pkg.name,
    onNpm: view.exitCode === 0,
    published: all.includes(pkg.version),
    version: pkg.version
  }
}
const publishOne = async (t: Target): Promise<Target & { ok: boolean }> => {
  const pub = await runCommand(['bun', 'publish', '--access', 'public'], t.dir)
  if (pub.exitCode === 0) return { ...t, ok: true }
  const recheck = await runCommand(['npm', 'view', `${t.name}@${t.version}`, 'version'])
  const isPublished = recheck.exitCode === 0 && recheck.stdout.trim().length > 0
  if (!isPublished) console.error(`${nameVer(t)} publish failed: ${pub.stderr.trim()}\n${recheck.stderr.trim()}`)
  return { ...t, ok: isPublished }
}
const staleTags = async (tag: string): Promise<string[]> => {
  const ls = await runCommand(['git', 'ls-remote', '--tags', 'origin'])
  if (ls.exitCode !== 0)
    throw new Error(`cannot list remote tags, so whether older ones remain is unknown: ${ls.stderr.trim()}`)
  const names = ls.stdout
    .split('\n')
    .map(line => line.split('/').at(-1) ?? '')
    .filter(t => t && t !== tag && !t.endsWith('^{}'))
  return [...new Set(names)]
}
const tagAndRelease = async (results: Target[]): Promise<{ code: number; tag: string }> => {
  const first = results[0]
  const tag = `v${first?.version ?? '0.0.0'}`
  const tagged = await runCommand(['git', 'tag', tag])
  const pushed = tagged.exitCode === 0 ? await runCommand(['git', 'push', 'origin', tag]) : tagged
  const released =
    pushed.exitCode === 0 ? await runCommand(['gh', 'release', 'create', tag, '--title', tag, '--generate-notes']) : pushed
  if (released.exitCode === 0) return { code: 0, tag }
  console.error(`published ${results.map(nameVer).join(', ')} but ${tag} did not land: ${released.stderr.trim()}`)
  return { code: 1, tag }
}
const pruneStaleTags = async (tag: string): Promise<number> => {
  await Promise.all(
    (await staleTags(tag)).map(async t => {
      await runCommand(['gh', 'release', 'delete', t, '--yes', '--cleanup-tag'])
      await runCommand(['git', 'push', 'origin', `:refs/tags/${t}`])
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
const cleanupOne = async (target: Target): Promise<number> => {
  try {
    const result = await runCommand(['bunx', 'pm4ai@latest', 'cleanup'], target.dir, 15 * 60_000)
    if (result.stdout !== '') console.log(result.stdout)
    if (result.stderr !== '') console.error(result.stderr)
    if (result.exitCode !== 0) console.error(`${nameVer(target)} cleanup failed: exit ${result.exitCode}`)
    return result.exitCode
  } catch (error) {
    console.error(`${nameVer(target)} cleanup failed: ${String(error)}`)
    return 1
  }
}
const main = async (): Promise<number> => {
  const resolved = (await Promise.all(pkgs.map(async ({ path, pkg }) => resolve(path, pkg)))).filter(
    (t): t is Target => t !== undefined
  )
  const toPublish = selectToPublish(resolved)
  let code = 0
  try {
    if (toPublish !== undefined) code = await publishAll(toPublish)
  } catch (error) {
    console.error(`release failed: ${String(error)}`)
    code = 1
  }
  const pruned = await Promise.all(resolved.filter(t => t.onNpm).map(cleanupOne))
  return code !== 0 || pruned.some(result => result !== 0) ? 1 : 0
}
process.exitCode = await main()
