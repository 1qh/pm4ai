import { describe, expect, test } from 'bun:test'
import type { Issue } from '../types.js'
import { formatIssues, hasRealIssues } from '../format.js'
describe('formatIssues', () => {
  test('empty issues returns empty string', () => {
    expect(formatIssues('/tmp/test', [])).toBe('')
  })
  test('with issues returns formatted output', () => {
    const issues: Issue[] = [
      { detail: 'missing turbo.json', type: 'missing' },
      { detail: 'drift in tsconfig', type: 'drift' }
    ]
    const result = formatIssues('/tmp/test', issues)
    expect(result).toContain('/tmp/test')
    expect(result).toContain('missing missing turbo.json')
    expect(result).toContain('drift drift in tsconfig')
  })
})
describe('hasRealIssues', () => {
  test('info-only returns false', () => {
    expect(hasRealIssues([{ detail: 'passed 2024-01-01', type: 'info' }])).toBe(false)
  })
  test('real issue returns true', () => {
    expect(hasRealIssues([{ detail: 'something broken', type: 'drift' }])).toBe(true)
  })
  test('empty returns false', () => {
    expect(hasRealIssues([])).toBe(false)
  })
})
