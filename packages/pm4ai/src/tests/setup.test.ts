import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
describe('setup templates', () => {
  test('SwiftBar plugin uses bunx pm4ai@latest', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'setup.ts'), 'utf8')
    expect(src).toContain('bunx pm4ai@latest status --swiftbar')
  })
  test('SwiftBar plugin sets PATH', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'setup.ts'), 'utf8')
    expect(src).toContain('export PATH=')
    expect(src).toContain('.bun/bin')
  })
  test('launchd plist targets pm4ai@latest fix', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'setup.ts'), 'utf8')
    expect(src).toContain('pm4ai@latest')
    expect(src).toContain('fix')
  })
  test('launchd plist runs daily at 9am', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'setup.ts'), 'utf8')
    expect(src).toContain('<integer>9</integer>')
    expect(src).toContain('<integer>0</integer>')
  })
})
describe('streaming plugin', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'setup.ts'), 'utf8')
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
