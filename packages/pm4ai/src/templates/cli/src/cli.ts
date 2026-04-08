#!/usr/bin/env bun
/* eslint-disable no-console */
import pkg from '../package.json' with { type: 'json' }
const args = process.argv.slice(2)
const flags = new Set(args.filter(a => a.startsWith('-')))
const command = args.find(a => !a.startsWith('-'))
if (flags.has('--version') || flags.has('-v')) console.log(pkg.version)
else if (command === 'hello') console.log(`Hello from ${pkg.name}!`)
else if (command === 'tui') {
  const { run } = await import('./tui.js')
  await run()
} else
  console.log(
    `${pkg.name} v${pkg.version}\n\nCommands:\n  hello  — say hello\n  tui    — interactive terminal UI\n  -v     — show version`
  )
