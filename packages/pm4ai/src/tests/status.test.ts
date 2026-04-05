import { describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { getUiSyncTime } from '../format.js'
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
  test('0 minutes ago', () => {
    const iso = new Date().toISOString()
    expect(timeAgo(iso)).toBe('0m ago')
  })
  test('59 minutes shows minutes', () => {
    const iso = new Date(Date.now() - 59 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('59m ago')
  })
  test('60 minutes shows 1h', () => {
    const iso = new Date(Date.now() - 60 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('1h ago')
  })
  test('23 hours shows hours', () => {
    const iso = new Date(Date.now() - 23 * 60 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('23h ago')
  })
})
describe('getUiSyncTime', () => {
  test('returns ? for paths without readonly/ui', async () => {
    const result = await getUiSyncTime(['/tmp/nonexistent'])
    expect(result).toBe('?')
  })
  test('returns time for real pm4ai repo', async () => {
    const pm4aiPath = join(import.meta.dirname, '..', '..', '..', '..')
    const result = await getUiSyncTime([pm4aiPath])
    expect(result).toBe('?')
  })
  test('returns ? for empty paths array', async () => {
    const result = await getUiSyncTime([])
    expect(result).toBe('?')
  })
})
describe('status module exports', () => {
  test('status function is exported and callable', async () => {
    const { status } = await import('../status.js')
    expect(typeof status).toBe('function')
  })
  test('timeAgo is exported from status', async () => {
    const mod = await import('../status.js')
    expect(typeof mod.timeAgo).toBe('function')
  })
})
describe('status() via CLI', () => {
  const cliPath = join(import.meta.dirname, '..', '..', 'dist', 'cli.js')
  const pm4aiPath = join(import.meta.dirname, '..', '..', '..', '..')
  test('status command runs on real project', () => {
    const result = execSync(`bun ${cliPath} status`, { cwd: pm4aiPath, encoding: 'utf8', timeout: 30_000 })
    expect(result).toContain('pm4ai')
  }, 30_000)
  test('status --all runs on all projects', () => {
    const result = execSync(`bun ${cliPath} status --all`, { cwd: pm4aiPath, encoding: 'utf8', timeout: 60_000 })
    expect(result).toContain('/Users/o/z/')
  }, 60_000)
  test('status --swiftbar outputs SwiftBar format', () => {
    const result = execSync(`bun ${cliPath} status --swiftbar`, { cwd: pm4aiPath, encoding: 'utf8', timeout: 120_000 })
    expect(result).toContain('sfimage=')
    expect(result).toContain('Refresh | refresh=true')
  }, 120_000)
})
