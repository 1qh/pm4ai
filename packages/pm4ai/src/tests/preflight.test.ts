import { describe, expect, test } from 'bun:test'
import { preflight } from '../preflight.js'
describe('preflight', () => {
  test('returns true when required tools are available', async () => {
    const result = await preflight()
    expect(result).toBe(true)
  })
})
