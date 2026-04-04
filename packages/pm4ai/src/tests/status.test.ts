import { describe, expect, test } from 'bun:test'
import { timeAgo } from '../status.js'
describe('timeAgo', () => {
  test('5 minutes ago', () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('5m ago')
  })
  test('2 hours ago', () => {
    const iso = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('2h ago')
  })
  test('3 days ago', () => {
    const iso = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('3d ago')
  })
  test('invalid date returns NaN gracefully', () => {
    const result = timeAgo('not-a-date')
    expect(result).toContain('NaN')
  })
})
