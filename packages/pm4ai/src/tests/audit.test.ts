import { describe, expect, test } from 'bun:test'
import { usesForbidden } from '../audit.js'
describe('usesForbidden', () => {
  test('npm publish is forbidden', () => {
    expect(usesForbidden('npm publish')).toBe(true)
  })
  test('bun publish is allowed', () => {
    expect(usesForbidden('bun publish')).toBe(false)
  })
  test('forbidden after &&', () => {
    expect(usesForbidden('lintmax fix && npm run build')).toBe(true)
  })
})
