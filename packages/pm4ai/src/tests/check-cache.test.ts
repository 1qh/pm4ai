import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCheckResult, writeCheckResult } from '../check-cache.js'
const makeTmp = () => mkdtempSync(join(tmpdir(), 'pm4ai-cc-'))
describe('writeCheckResult + readCheckResult', () => {
  test('writes and reads back a passing result', () => {
    const tmp = makeTmp()
    writeCheckResult({ pass: true, projectPath: tmp, violations: 0 })
    const result = readCheckResult(tmp)
    expect(result).toBeDefined()
    expect(result?.pass).toBe(true)
    expect(result?.violations).toBe(0)
    expect(result?.at).toBeDefined()
    rmSync(tmp, { recursive: true })
  })
  test('writes and reads back a failing result', () => {
    const tmp = makeTmp()
    writeCheckResult({ pass: false, projectPath: tmp, summary: 'lint failed', violations: 5 })
    const result = readCheckResult(tmp)
    expect(result?.pass).toBe(false)
    expect(result?.violations).toBe(5)
    expect(result?.summary).toBe('lint failed')
    rmSync(tmp, { recursive: true })
  })
  test('returns undefined when no result exists', () => {
    const tmp = makeTmp()
    expect(readCheckResult(tmp)).toBeUndefined()
    rmSync(tmp, { recursive: true })
  })
  test('overwrites previous result', () => {
    const tmp = makeTmp()
    writeCheckResult({ pass: true, projectPath: tmp, violations: 0 })
    writeCheckResult({ pass: false, projectPath: tmp, summary: 'broke', violations: 3 })
    const result = readCheckResult(tmp)
    expect(result?.pass).toBe(false)
    expect(result?.violations).toBe(3)
    rmSync(tmp, { recursive: true })
  })
  test('different paths produce different cache files', () => {
    const tmp1 = makeTmp()
    const tmp2 = makeTmp()
    writeCheckResult({ pass: true, projectPath: tmp1, violations: 0 })
    writeCheckResult({ pass: false, projectPath: tmp2, violations: 7 })
    expect(readCheckResult(tmp1)?.pass).toBe(true)
    expect(readCheckResult(tmp2)?.pass).toBe(false)
    rmSync(tmp1, { recursive: true })
    rmSync(tmp2, { recursive: true })
  })
})
