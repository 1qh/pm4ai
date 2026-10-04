import { describe, expect, test } from 'bun:test'
import { preflight } from '../preflight.js'
describe('preflight', () => {
  test('returns true when required tools are available', async () => {
    const result = await preflight()
    expect(result).toBe(true)
  })
  test('returns boolean type', async () => {
    const result = await preflight()
    expect(typeof result).toBe('boolean')
  })
  test('does not throw on missing optional tools', async () => {
    const result = await preflight()
    expect(result).toBeDefined()
  })
})
