/* eslint-disable no-console */
/** biome-ignore-all lint/performance/noAwaitInLoops: sequential npm operations must stay ordered */
import { $, file } from 'bun'
import { join } from 'node:path'
import { parseJson } from './json.js'
const cleanup = async () => {
  const pkgPath = join(process.cwd(), 'package.json')
  const pkg = parseJson<{ name?: string; version?: string }>(await file(pkgPath).text())
  if (!(pkg.name && pkg.version)) {
    console.error('package.json missing name or version')
    process.exitCode = 1
    return
  }
  const result = await $`npm view ${pkg.name} versions --json`.quiet().nothrow()
  if (result.exitCode !== 0) {
    console.log(`${pkg.name}: first publish, nothing to clean`)
    return
  }
  const versions = parseJson<string | string[]>(result.stdout.toString())
  const allVersions = Array.isArray(versions) ? versions : [versions]
  const old = allVersions.filter(v => v !== pkg.version)
  if (old.length === 0) {
    console.log(`${pkg.name}: no old versions`)
    return
  }
  for (const v of old) {
    const spec = `${pkg.name}@${v}`
    // eslint-disable-next-line no-await-in-loop
    const r = await $`npm unpublish ${spec}`.nothrow()
    if (r.exitCode === 0) console.log(`${spec} unpublished`)
    else {
      // eslint-disable-next-line no-await-in-loop
      const d = await $`npm deprecate ${spec} ${'superseded by latest'}`.nothrow()
      console.log(d.exitCode === 0 ? `${spec} deprecated` : `${spec} left as-is`)
    }
  }
}
export { cleanup }
