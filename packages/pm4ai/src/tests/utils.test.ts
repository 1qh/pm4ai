import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectName, readJson } from '../utils.js'
describe('projectName', () => {
  test('extracts last segment', () => {
    expect(projectName('/Users/o/z/pm4ai')).toBe('pm4ai')
  })
  test('empty string returns empty', () => {
    expect(projectName('')).toBe('')
  })
})
describe('readJson', () => {
  test('nonexistent file returns undefined', async () => {
    expect(await readJson('/tmp/does-not-exist-xyz.json')).toBeUndefined()
  })
  test('valid JSON file returns parsed object', async () => {
    const p = join(tmpdir(), `test-${Date.now()}.json`)
    writeFileSync(p, '{"a":1}')
    expect(await readJson<{ a: number }>(p)).toEqual({ a: 1 })
  })
  test('malformed JSON returns undefined', async () => {
    const p = join(tmpdir(), `test-bad-${Date.now()}.json`)
    writeFileSync(p, '{broken')
    expect(await readJson(p)).toBeUndefined()
  })
})
