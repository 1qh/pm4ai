/* eslint-disable no-console */
/** biome-ignore-all lint/performance/noAwaitInLoops: sequential npm operations must stay ordered */
import { $, file } from 'bun'
import { join } from 'node:path'
import { parseJson } from './json.js'
const retireVersion = async (spec: string) => {
  const r = await $`npm unpublish ${spec}`.nothrow()
  if (r.exitCode === 0) {
    console.log(`${spec} unpublished`)
    return
  }
  const d = await $`npm deprecate ${spec} ${'superseded by latest'}`.nothrow()
  console.log(d.exitCode === 0 ? `${spec} deprecated` : `${spec} left as-is`)
}
const readOldVersions = async (name: string, current: string): Promise<string[] | undefined> => {
  const result = await $`npm view ${name} versions --json`.quiet().nothrow()
  if (result.exitCode !== 0) return
  const versions = parseJson<string | string[]>(result.stdout.toString())
  const allVersions = Array.isArray(versions) ? versions : [versions]
  return allVersions.filter(v => v !== current)
}
const cleanupVersions = async (name: string, version: string) => {
  const old = await readOldVersions(name, version)
  if (!old) {
    console.log(`${name}: first publish, nothing to clean`)
    return
  }
  if (old.length === 0) {
    console.log(`${name}: no old versions`)
    return
  }
  // eslint-disable-next-line no-await-in-loop
  for (const v of old) await retireVersion(`${name}@${v}`)
}
const cleanup = async () => {
  const pkgPath = join(process.cwd(), 'package.json')
  const pkg = parseJson<{ name?: string; version?: string }>(await file(pkgPath).text())
  if (!(pkg.name && pkg.version)) {
    console.error('package.json missing name or version')
    process.exitCode = 1
    return
  }
  await cleanupVersions(pkg.name, pkg.version)
}
export { cleanup }
