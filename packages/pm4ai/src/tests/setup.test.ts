import { file } from 'bun'
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
const readSetupSource = async () => file(join(import.meta.dirname, '..', 'setup.ts')).text()
describe('setup templates', () => {
  test.each([
    { expected: ['bunx pm4ai@latest status --swiftbar'], title: 'SwiftBar plugin uses bunx pm4ai@latest' },
    { expected: ['export PATH=', '.bun/bin'], title: 'SwiftBar plugin sets PATH' },
    { expected: ['pm4ai@latest', 'fix'], title: 'launchd plist targets pm4ai@latest fix' },
    { expected: ['<integer>9</integer>', '<integer>0</integer>'], title: 'launchd plist runs daily at 9am' }
  ])('$title', async ({ expected }) => {
    const src = await readSetupSource()
    for (const value of expected) expect(src).toContain(value)
  })
})
describe('streaming plugin', () => {
  test.each([
    { expected: ['swiftbar.type>streamable'], title: 'declares swiftbar.type as streamable' },
    { expected: ['#!/usr/bin/env bun'], title: 'uses bun shebang' },
    { expected: ['watch.sock'], title: 'connects to watch.sock' },
    { expected: ['~~~'], title: 'outputs ~~~ separator for streaming' },
    { expected: ['.pm4ai', 'checks'], title: 'reads check cache for idle state' },
    { expected: ['⠋'], title: 'has spinner animation' },
    { expected: ['process.exit(0)'], title: 'falls back when no socket' }
  ])('$title', async ({ expected }) => {
    const src = await readSetupSource()
    for (const value of expected) expect(src).toContain(value)
  })
})
