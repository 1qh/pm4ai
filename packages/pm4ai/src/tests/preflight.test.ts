import { describe, expect, test } from 'bun:test'
import { didPassPreflight } from '../preflight.js'
describe('didPassPreflight', () => {
  test('returns true when required tools are available', async () => {
    const result = await didPassPreflight()
    expect(result).toBe(true)
  })
  test('returns boolean type', async () => {
    const result = await didPassPreflight()
    expect(typeof result).toBe('boolean')
  })
  test('does not throw on missing optional tools', async () => {
    const result = await didPassPreflight()
    expect(result).toBeDefined()
  })
})
