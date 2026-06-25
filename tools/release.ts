#!/usr/bin/env bun
/* eslint-disable no-console */
import { $, file, Glob } from 'bun'
import { dirname, join } from 'node:path'

interface Pkg {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  name?: string
  private?: boolean
  version?: string
  workspaces?: string[]
}
const root = process.cwd()
const rootPkg = (await file(join(root, 'package.json'))
  .json()
  .catch(() => ({}))) as Pkg
const globs = rootPkg.workspaces ?? ['packages/*']
const findPublishable = async (): Promise<null | { dir: string; name: string; version: string }> => {
  const rootCandidate = rootPkg.name && rootPkg.version && !rootPkg.private ? [join(root, 'package.json')] : []
  const scanned = await Promise.all(
    globs.map(async g =>
      (await Array.fromAsync(new Glob(`${g}/package.json`).scan({ cwd: root }))).map(rel => join(root, rel))
    )
  )
  const candidates = [...rootCandidate, ...scanned.flat()]
  const pkgs = await Promise.all(
    candidates.map(async path => ({
      path,
      pkg: (await file(path)
        .json()
        .catch(() => ({}))) as Pkg
    }))
  )
  const internal = new Set(
    pkgs.flatMap(({ pkg }) =>
      Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
        .filter(([, v]) => typeof v === 'string' && v.startsWith('workspace:'))
        .map(([dep]) => dep)
    )
  )
  const hit = pkgs.find(({ pkg }) => pkg.name && pkg.version && !pkg.private && !internal.has(pkg.name))
  if (!(hit?.pkg.name && hit.pkg.version)) return null
  return { dir: dirname(hit.path), name: hit.pkg.name, version: hit.pkg.version }
}
const target = await findPublishable()
if (!target) {
  console.log('no publishable package')
  process.exit(0)
}
const { dir, name, version } = target
const tag = `v${version}`
const published = await $`npm view ${name}@${version} version`.quiet().nothrow()
if (published.exitCode === 0 && published.stdout.toString().trim()) {
  console.log(`${name}@${version} already published`)
  process.exit(0)
}
const pub = await $`bun publish --access public`.cwd(dir).nothrow()
if (pub.exitCode !== 0) {
  console.error(`publish failed for ${name}@${version}`)
  process.exit(1)
}
await $`git tag ${tag}`.nothrow()
await $`git push origin ${tag}`.nothrow()
await $`gh release create ${tag} --title ${tag} --generate-notes`.nothrow()
console.log(`released ${name}@${version}`)
