/* eslint-disable no-console */
import { $ } from 'bun'
const REQUIRED = ['rg', 'git']
const OPTIONAL = ['gh']
const isInstalled = async (name: string): Promise<boolean> => {
  const r = await $`which ${name}`.quiet().nothrow()
  return r.exitCode === 0
}
const didPassPreflight = async (): Promise<boolean> => {
  const [requiredResults, optionalResults] = await Promise.all([
    Promise.all(REQUIRED.map(async name => ({ found: await isInstalled(name), name }))),
    Promise.all(OPTIONAL.map(async name => ({ found: await isInstalled(name), name })))
  ])
  const missingRequired = requiredResults.filter(r => !r.found)
  const missingOptional = optionalResults.filter(r => !r.found)
  if (missingRequired.length > 0) {
    console.log('missing required:')
    for (const r of missingRequired) console.log(`  ${r.name}`)
  }
  if (missingOptional.length > 0) {
    console.log('missing optional (some checks skipped):')
    for (const r of missingOptional) console.log(`  ${r.name}`)
  }
  return missingRequired.length === 0
}
export { didPassPreflight }
