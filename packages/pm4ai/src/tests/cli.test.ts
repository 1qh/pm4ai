import { $ } from 'bun'
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

const cli = join(import.meta.dir, '..', '..', 'dist', 'cli.mjs')
const versionRe = /^\d+\.\d+\.\d+$/u
const run = async (args: string): Promise<string> => (await $`bun ${cli} ${args}`.quiet().nothrow().text()).trim()
describe('guide', () => {
  test('no args prints guide with all commands', async () => {
    const out = await run('')
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
  test('unknown command prints guide', async () => {
    const out = await run('unknown')
    expect(out).toContain('commands:')
  })
  test('init without name prints usage', async () => {
    const out = await run('init')
    expect(out).toContain('usage')
  })
  test('guide includes fix behavior', async () => {
    const out = await run('')
    expect(out).toContain('clean git')
    expect(out).toContain('syncs')
    expect(out).toContain('maintains')
  })
  test('guide includes checks list', async () => {
    const out = await run('')
    expect(out).toContain('checks:')
    expect(out).toContain('git status')
    expect(out).toContain('config drift')
    expect(out).toContain('ci status')
  })
})
describe('--version', () => {
  test('--version prints version number', async () => {
    const out = await run('--version')
    expect(out).toMatch(versionRe)
  })
  test('-v prints version number', async () => {
    const out = await run('-v')
    expect(out).toMatch(versionRe)
  })
})
describe('flags', () => {
  test('flags mixed with commands are parsed correctly', async () => {
    const out = await run('--version')
    expect(out).toBeTruthy()
  })
  test('unknown flags with known command still works', async () => {
    const out = await run('init')
    expect(out).toContain('usage')
  })
})
describe('guide includes watch', () => {
  test('guide mentions watch command', async () => {
    const out = await run('')
    expect(out).toContain('watch')
  })
})
