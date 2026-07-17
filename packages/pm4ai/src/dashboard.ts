/* eslint-disable no-console */
import { write } from 'bun'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { discover } from './discover.js'

const dirExists = async (p: string): Promise<boolean> => {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}
const dashboard = async () => {
  const { self } = await discover()
  const dashboardDir = join(self.path, 'apps', 'web')
  const dashboardExists = await dirExists(dashboardDir)
  if (!dashboardExists) {
    console.log('dashboard app not found at', dashboardDir)
    console.log('run from pm4ai monorepo or ensure apps/web exists')
    process.exitCode = 1
    return
  }
  const token = randomUUID()
  const tokenFile = join(dashboardDir, '.auth-token')
  await write(tokenFile, token)
  const url = `http://localhost:4200/auth/${token}`
  console.log(`dashboard: ${url}`)
  console.log('(token is one-time use — copy URL if port-forwarding)')
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- dev/fleet tool invoking a trusted PATH tool
  const proc = spawn('bun', ['run', 'dev'], { cwd: dashboardDir, stdio: 'inherit' })
  setTimeout(() => {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- dev/fleet tool invoking a trusted PATH tool
    if (process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore' }).unref()
  }, 2000)
  await new Promise<void>((resolve, reject) => {
    proc.on('close', code => {
      unlink(tokenFile).catch(() => {
        /* Already removed */
      })
      if (code === 0) resolve()
      else reject(new Error(`dashboard exited with code ${code}`))
    })
  })
}
export { dashboard }
