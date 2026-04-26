/** biome-ignore-all lint/performance/noAwaitInLoops: sequential batches */
import { expect, test } from 'bun:test'
import { ALL_BANNED } from '../banned.js'
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
test('all banned packages exist on npm', async () => {
  const names = [...new Set(ALL_BANNED.map(b => extractExactName(b.ban)).filter(Boolean))] as string[]
  const batchSize = 50
  const missing: string[] = []
  for (let i = 0; i < names.length; i += batchSize) {
    const batch = names.slice(i, i + batchSize)
    const results = await Promise.all(batch.map(async name => ({ exists: await checkExists(name), name })))
    for (const r of results) if (!r.exists) missing.push(r.name)
  }
  expect(missing).toEqual([])
}, 120_000)
