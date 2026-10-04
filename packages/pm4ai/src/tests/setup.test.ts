import { file } from 'bun'
import { beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
describe('setup templates', () => {
  test.each([
    { expected: ['bunx pm4ai@latest status --swiftbar'], title: 'SwiftBar plugin uses bunx pm4ai@latest' },
    { expected: ['export PATH=', '.bun/bin'], title: 'SwiftBar plugin sets PATH' },
    { expected: ['pm4ai@latest', 'fix'], title: 'launchd plist targets pm4ai@latest fix' },
    { expected: ['<integer>9</integer>', '<integer>0</integer>'], title: 'launchd plist runs daily at 9am' }
  ])('$title', async ({ expected }) => {
    const src = await file(join(import.meta.dirname, '..', 'setup.ts')).text()
    for (const value of expected) expect(src).toContain(value)
  })
})
describe('streaming plugin', () => {
  let src = ''
  beforeAll(async () => {
    src = await file(join(import.meta.dirname, '..', 'setup.ts')).text()
  })
  test('declares swiftbar.type as streamable', () => {
    expect(src).toContain('swiftbar.type>streamable')
  })
  test('uses bun shebang', () => {
    expect(src).toContain('#!/usr/bin/env bun')
  })
  test('connects to watch.sock', () => {
    expect(src).toContain('watch.sock')
  })
  test('outputs ~~~ separator for streaming', () => {
    expect(src).toContain('~~~')
  })
  test('reads check cache for idle state', () => {
    expect(src).toContain('.pm4ai')
    expect(src).toContain('checks')
  })
  test('has spinner animation', () => {
    expect(src).toContain('⠋')
  })
  test('falls back when no socket', () => {
    expect(src).toContain('process.exit(0)')
  })
})
