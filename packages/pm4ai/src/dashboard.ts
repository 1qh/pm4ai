/* eslint-disable no-console */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { discover } from './discover.js'
const dashboard = async () => {
  const { self } = await discover()
  const dashboardDir = join(self.path, 'apps', 'web')
  if (!existsSync(dashboardDir)) {
    console.log('dashboard app not found at', dashboardDir)
    console.log('run from pm4ai monorepo or ensure apps/web exists')
    return
  }
  const token = randomUUID()
  const tokenFile = join(dashboardDir, '.auth-token')
  writeFileSync(tokenFile, token)
  const url = `http://localhost:4200/auth/${token}`
  console.log(`dashboard: ${url}`)
  console.log('(token is one-time use — copy URL if port-forwarding)')
  const proc = spawn('bun', ['run', 'dev'], { cwd: dashboardDir, stdio: 'inherit' })
  setTimeout(() => {
    if (process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore' }).unref()
  }, 2000)
  await new Promise<void>((resolve, reject) => {
    proc.on('close', code => {
      try {
        unlinkSync(tokenFile)
      } catch {
        /* Already removed */
      }
      if (code === 0) resolve()
      else reject(new Error(`dashboard exited with code ${code}`))
    })
  })
}
export { dashboard }
