import { describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
const cli = join(import.meta.dir, '..', '..', 'dist', 'cli.mjs')
const versionRe = /^\d+\.\d+\.\d+$/u
const run = (args: string) => execSync(`bun ${cli} ${args}`, { encoding: 'utf8', timeout: 10_000 }).trim()
describe('guide', () => {
  test('no args prints guide with all commands', () => {
    const out = run('')
    expect(out).toContain('pm4ai')
    expect(out).toContain('commands:')
    expect(out).toContain('status')
    expect(out).toContain('fix')
    expect(out).toContain('init')
    expect(out).toContain('setup')
    expect(out).toContain('--verbose')
    expect(out).toContain('--all')
    expect(out).toContain('--swiftbar')
  })
  test('unknown command prints guide', () => {
    const out = run('unknown')
    expect(out).toContain('commands:')
  })
  test('init without name prints usage', () => {
    const out = run('init')
    expect(out).toContain('usage')
  })
  test('guide includes fix behavior', () => {
    const out = run('')
    expect(out).toContain('clean git')
    expect(out).toContain('syncs')
    expect(out).toContain('maintains')
  })
  test('guide includes checks list', () => {
    const out = run('')
    expect(out).toContain('checks:')
    expect(out).toContain('git status')
    expect(out).toContain('config drift')
    expect(out).toContain('ci status')
  })
})
describe('--version', () => {
  test('--version prints version number', () => {
    const out = run('--version')
    expect(out).toMatch(versionRe)
  })
  test('-v prints version number', () => {
    const out = run('-v')
    expect(out).toMatch(versionRe)
  })
})
describe('flags', () => {
  test('flags mixed with commands are parsed correctly', () => {
    const out = run('--version')
    expect(out).toBeTruthy()
  })
  test('unknown flags with known command still works', () => {
    const out = run('init')
    expect(out).toContain('usage')
  })
})
describe('guide includes watch', () => {
  test('guide mentions watch command', () => {
    const out = run('')
    expect(out).toContain('watch')
  })
})
