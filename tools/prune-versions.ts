#!/usr/bin/env bun
/** biome-ignore-all lint/performance/noAwaitInLoops: npm calls are serialised to avoid concurrent manifest-write 422s */
/* eslint-disable no-console */
import { $, file } from 'bun'
import { join } from 'node:path'
const toVersionList = (parsed: unknown): string[] => {
  if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string')
  if (typeof parsed === 'string') return [parsed]
  return []
}
const readPkg = async (path: string): Promise<{ name?: string; version?: string }> => {
  const parsed: unknown = await file(path).json()
  return typeof parsed === 'object' && parsed !== null ? parsed : {}
}
const retireVersions = async (name: string, old: string[]): Promise<number> => {
  const retained: string[] = []
  for (const v of old) {
    // eslint-disable-next-line no-await-in-loop -- sequential to avoid concurrent npm manifest-write 422s
    const un = await $`npm unpublish ${name}@${v}`.nothrow()
    if (un.exitCode === 0) console.log(`${name}@${v} unpublished`)
    else {
      // eslint-disable-next-line no-await-in-loop -- sequential to avoid concurrent npm manifest-write 422s
      const dep = await $`npm deprecate ${name}@${v} ${'superseded by latest'}`.nothrow()
      if (dep.exitCode === 0) console.log(`${name}@${v} deprecated`)
      else retained.push(v)
    }
  }
  if (retained.length > 0) console.log(`${name}: retained by npm policy (past unpublish window): ${retained.join(', ')}`)
  return 0
}
const pruneListedVersions = async (name: string, version: string, output: string): Promise<number> => {
  const allVersions = toVersionList(JSON.parse(output))
  const old = allVersions.filter(v => v !== version)
  if (old.length === 0) {
    console.log(`${name}: no old versions`)
    return 0
  }
  const exitCode = await retireVersions(name, old)
  return exitCode
}
const notFoundRe = /E404|404 Not Found/u
const pruneFromRegistry = async (name: string, version: string): Promise<number> => {
  const view = await $`npm view ${name} versions --json`.quiet().nothrow()
  if (view.exitCode !== 0 && !notFoundRe.test(view.stderr.toString())) {
    console.error(`npm view ${name} failed, so its old versions are unknown: ${view.stderr.toString().trim()}`)
    return 1
  }
  if (view.exitCode !== 0) {
    console.log(`${name}: first publish, nothing to clean`)
    return 0
  }
  const exitCode = await pruneListedVersions(name, version, view.stdout.toString())
  return exitCode
}
const main = async (): Promise<number> => {
  const pkgPath = join(process.cwd(), 'package.json')
  const pkg = await readPkg(pkgPath)
  if (!(pkg.name && pkg.version)) {
    console.error('package.json missing name or version')
    return 1
  }
  const exitCode = await pruneFromRegistry(pkg.name, pkg.version)
  return exitCode
}
process.exitCode = await main()
