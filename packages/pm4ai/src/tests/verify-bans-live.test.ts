import { describe, expect, test } from 'bun:test'
import { ALL_BANNED } from '../banned.js'
const extractExactName = (ban: string): string | undefined => {
  if (!ban.endsWith('"')) return
  const clean = ban.slice(1, -1)
  if (clean.length === 0) return
  return clean
}
const isPublished = async (name: string): Promise<boolean> => {
  const res = await fetch(`https://registry.npmjs.org/${name}`, { method: 'HEAD' })
  return res.ok
}
describe('banned packages registry', () => {
  test('all banned packages exist on npm', async () => {
    if (!process.env.PM4AI_LIVE) return
    const names = [
      ...new Set(ALL_BANNED.map(b => extractExactName(b.ban)).filter((name): name is string => name !== undefined))
    ]
    const batchSize = 50
    const missing: string[] = []
    for (let i = 0; i < names.length; i += batchSize) {
      const batch = names.slice(i, i + batchSize)
      const results = await Promise.all(batch.map(async name => ({ exists: await isPublished(name), name })))
      for (const r of results) if (!r.exists) missing.push(r.name)
    }
    expect(missing).toStrictEqual([])
  }, 120_000)
})
