import { describe, expect, test } from 'bun:test'
import type { Issue } from '../types.js'
import { formatIssues, hasRealIssues, shellEscape } from '../format.js'
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
  test('check passed is not real', () => {
    expect(hasRealIssues([{ detail: 'passed 5m ago (current)', type: 'check' }])).toBe(false)
  })
  test('check failed is real', () => {
    expect(hasRealIssues([{ detail: 'failed 5m ago, 3 violations', type: 'check' }])).toBe(true)
  })
})
describe('shellEscape', () => {
  test('plain text unchanged', () => {
    expect(shellEscape('hello world')).toBe('hello world')
  })
  test('escapes dollar sign', () => {
    expect(shellEscape('$(rm -rf /)')).toBe(String.raw`\$\(rm -rf /\)`)
  })
  test('escapes backticks', () => {
    expect(shellEscape('`whoami`')).toBe('\\`whoami\\`')
  })
  test('escapes single quotes', () => {
    expect(shellEscape("it's")).toBe(String.raw`it\'s`)
  })
  test('escapes double quotes', () => {
    expect(shellEscape('"quoted"')).toBe(String.raw`\"quoted\"`)
  })
  test('escapes exclamation mark', () => {
    expect(shellEscape('hello!')).toBe(String.raw`hello\!`)
  })
  test('escapes pipe and ampersand', () => {
    expect(shellEscape('a | b && c')).toBe(String.raw`a \| b \&\& c`)
  })
  test('escapes semicolons and parentheses', () => {
    expect(shellEscape('; echo $(id)')).toBe(String.raw`\; echo \$\(id\)`)
  })
  test('preserves safe characters', () => {
    expect(shellEscape('file.ts:42 path/to/src @scope/pkg key=val')).toBe('file.ts:42 path/to/src @scope/pkg key=val')
  })
  test('handles empty string', () => {
    expect(shellEscape('')).toBe('')
  })
})
