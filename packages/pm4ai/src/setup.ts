/* eslint-disable no-console */
import { write } from 'bun'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
const SWIFTBAR_PLUGIN = `#!/bin/bash
# <swiftbar.hideAbout>true</swiftbar.hideAbout>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideLastUpdated>true</swiftbar.hideLastUpdated>
# <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>
# <swiftbar.hideSwiftBar>true</swiftbar.hideSwiftBar>
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
bunx pm4ai@latest status --swiftbar
`
const SWIFTBAR_STREAMING_PLUGIN = `#!/usr/bin/env bun
// <swiftbar.hideAbout>true</swiftbar.hideAbout>
// <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
// <swiftbar.hideLastUpdated>true</swiftbar.hideLastUpdated>
// <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>
// <swiftbar.hideSwiftBar>true</swiftbar.hideSwiftBar>
// <swiftbar.type>streamable</swiftbar.type>
import { createConnection } from 'node:net'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
const SOCK = join(homedir(), CONFIG_DIR, 'watch.sock')
const CHECKS = join(homedir(), CONFIG_DIR, 'checks')
const f = '| font=Menlo size=13'
const SPINNER = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']
const state = new Map()
let tick = 0
const getIdle = () => {
  if (!existsSync(CHECKS)) return '? | sfimage=questionmark.circle sfcolor=gray'
  const files = readdirSync(CHECKS).filter(f => f.endsWith('.json'))
  let pass = 0
  let total = 0
  const lines = []
  for (const file of files) {
    const path = '/' + file.replace('.json','').replaceAll('--','/')
    if (!existsSync(path) || path.startsWith('/tmp/')) continue
    total++
    try {
      const r = JSON.parse(readFileSync(join(CHECKS, file), 'utf8'))
      if (r.pass) pass++
      const name = path.split('/').pop()
      const mark = r.pass ? '🟢' : '🔴'
      lines.push(mark + ' ' + name + ' ' + f)
    } catch {}
  }
  const ok = pass === total
  const header = ok
    ? total + '/' + total + ' | sfimage=checkmark.circle.fill sfcolor=green'
    : pass + '/' + total + ' | sfimage=xmark.circle.fill sfcolor=red'
  return header + '\\n---\\n' + lines.join('\\n')
}
const render = () => {
  tick++
  const entries = [...state.entries()]
  if (entries.length === 0) return getIdle()
  const done = entries.filter(([,v]) => v.step === 'done').length
  const total = entries.length
  const spinner = SPINNER[tick % SPINNER.length]
  const active = entries.some(([,v]) => v.step !== 'done')
  const header = active
    ? spinner + ' ' + done + '/' + total + ' | sfimage=arrow.triangle.2.circlepath sfcolor=orange'
    : done + '/' + total + ' | sfimage=checkmark.circle.fill sfcolor=green'
  const lines = entries.map(([name, v]) => {
    if (v.step === 'done') return '✓ ' + name + ' ' + (v.detail || '') + ' ' + f + ' color=green'
    if (v.step) return spinner + ' ' + v.step + '... ' + name + ' ' + f + ' color=orange'
    return '● ' + name + ' ' + f + ' color=gray'
  })
  return header + '\\n---\\n' + lines.join('\\n')
}
const output = (s) => process.stdout.write(s.replace(/\\\\n/g, '\\n') + '\\n')
const sep = () => process.stdout.write('~~~\\n')
output(render())
if (!existsSync(SOCK)) process.exit(0)
const connect = () => {
  let buf = ''
  const sock = createConnection(SOCK)
  sock.on('data', chunk => {
    buf += chunk.toString()
    const lines = buf.split('\\n')
    buf = lines.pop()
    for (const line of lines) {
      if (!line) continue
      try {
        const e = JSON.parse(line)
        state.set(e.project, { step: e.step, status: e.status, detail: e.detail })
        sep()
        output(render())
      } catch {}
    }
  })
  sock.on('close', () => {
    state.clear()
    sep()
    output(render())
    setTimeout(connect, 2000)
  })
  sock.on('error', () => {})
}
connect()
setInterval(() => {
  if (state.size > 0) {
    sep()
    output(render())
  }
}, 100)
`
const bunPath = join(homedir(), '.bun', 'bin', 'bunx')
const launchdPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.pm4ai.fix</string>
    <key>ProgramArguments</key>
    <array>
        <string>${bunPath}</string>
        <string>pm4ai@latest</string>
        <string>fix</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${homedir()}/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/pm4ai.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/pm4ai.stderr.log</string>
</dict>
</plist>
`
const setup = async () => {
  const swiftbarDir = join(homedir(), 'Library', 'Application Support', 'SwiftBar', 'plugins')
  if (existsSync(join(homedir(), 'Library', 'Application Support', 'SwiftBar'))) {
    mkdirSync(swiftbarDir, { recursive: true })
    const pollingPath = join(swiftbarDir, 'pm4ai.1h.sh')
    const streamingPath = join(swiftbarDir, 'pm4ai-stream.1h.ts')
    await write(pollingPath, SWIFTBAR_PLUGIN)
    await write(streamingPath, SWIFTBAR_STREAMING_PLUGIN)
    const { chmod } = await import('node:fs/promises')
    await chmod(pollingPath, 0o755)
    await chmod(streamingPath, 0o755)
    console.log(`swiftbar polling plugin: ${pollingPath}`)
    console.log(`swiftbar streaming plugin: ${streamingPath}`)
  } else console.log('swiftbar not found, install with: brew install swiftbar')
  const launchdDir = join(homedir(), 'Library', 'LaunchAgents')
  mkdirSync(launchdDir, { recursive: true })
  const plistPath = join(launchdDir, 'com.pm4ai.fix.plist')
  await write(plistPath, launchdPlist)
  console.log(`launchd plist: ${plistPath}`)
  console.log('load with: launchctl load ~/Library/LaunchAgents/com.pm4ai.fix.plist')
}
export { setup }
