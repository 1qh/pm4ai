/* eslint-disable no-console */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { discover } from './discover.js'
const dashboard = async () => {
  const { self } = await discover()
  const dashboardDir = join(self.path, 'apps', 'dashboard')
  if (!existsSync(dashboardDir)) {
    console.log('dashboard app not found at', dashboardDir)
    console.log('run from pm4ai monorepo or ensure apps/dashboard exists')
    return
  }
  console.log('starting dashboard at http://localhost:4200')
  const proc = spawn('bun', ['run', 'dev'], { cwd: dashboardDir, stdio: 'inherit' })
  await new Promise<void>((resolve, reject) => {
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`dashboard exited with code ${code}`))
    })
  })
}
export { dashboard }
