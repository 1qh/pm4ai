/* eslint-disable no-await-in-loop */
/* oxlint-disable eslint/no-await-in-loop, eslint-plugin-unicorn/no-process-exit */
/** biome-ignore-all lint/performance/noAwaitInLoops: sequential batches */
import { ALL_BANNED } from './banned.js'
const extractExactName = (ban: string): string | undefined => {
  if (!ban.endsWith('"')) return
  const clean = ban.slice(1, -1)
  if (clean.length === 0) return
  return clean
}
const checkExists = async (name: string): Promise<boolean> => {
  const res = await fetch(`https://registry.npmjs.org/${name}`, { method: 'HEAD' })
  return res.ok
}
const batchSize = 50
const names = [...new Set(ALL_BANNED.map(b => extractExactName(b.ban)).filter(Boolean))] as string[]
const prefixCount = ALL_BANNED.length - names.length
const missing: string[] = []
for (let i = 0; i < names.length; i += batchSize) {
  const batch = names.slice(i, i + batchSize)
  const results = await Promise.all(batch.map(async name => ({ exists: await checkExists(name), name })))
  for (const r of results)
    if (!r.exists) {
      missing.push(r.name)
      process.stderr.write(`✗ ${r.name}\n`)
    }
  process.stderr.write(`${Math.min(i + batchSize, names.length)}/${names.length}\r`)
}
process.stderr.write('\n')
if (missing.length > 0) {
  process.stdout.write(`${missing.length} packages not found on npm:\n${missing.join('\n')}\n`)
  process.exit(1)
}
process.stdout.write(`verified: ${names.length} exact packages + ${prefixCount} prefix patterns\n`)
