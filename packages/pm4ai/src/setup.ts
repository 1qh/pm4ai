/* eslint-disable no-console */
import { write } from 'bun'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
const cliPath = join(import.meta.dir, 'cli.js')
const runCmd = existsSync(cliPath) ? `bun ${cliPath}` : 'bunx pm4ai@latest'
const SWIFTBAR_PLUGIN = `#!/bin/bash
# <swiftbar.hideAbout>true</swiftbar.hideAbout>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideLastUpdated>true</swiftbar.hideLastUpdated>
# <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>
# <swiftbar.hideSwiftBar>true</swiftbar.hideSwiftBar>
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
${runCmd} status --swiftbar
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
    const pluginPath = join(swiftbarDir, 'pm4ai.1h.sh')
    await write(pluginPath, SWIFTBAR_PLUGIN)
    const { chmod } = await import('node:fs/promises')
    await chmod(pluginPath, 0o755)
    console.log(`swiftbar plugin: ${pluginPath}`)
  } else console.log('swiftbar not found, install with: brew install swiftbar')
  const launchdDir = join(homedir(), 'Library', 'LaunchAgents')
  mkdirSync(launchdDir, { recursive: true })
  const plistPath = join(launchdDir, 'com.pm4ai.fix.plist')
  await write(plistPath, launchdPlist)
  console.log(`launchd plist: ${plistPath}`)
  console.log('load with: launchctl load ~/Library/LaunchAgents/com.pm4ai.fix.plist')
}
export { setup }
