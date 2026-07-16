import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
/** The Next build dir is a host-wide singleton: two `next dev` runs on one machine — a CI runner beside a local shell — compile into the same `.next` and serve each other's half-written output, which surfaces as an HTML error page where the test expects JSON. A run that owns its dist dir cannot collide. Relative only: an absolute path stops the server booting. */
const runDistDir = (): string => `.next/test-${String(process.pid)}`
/** Spawns `next dev` with a run-owned dist dir. Returns the child plus the dist path so the caller can remove exactly what it created — never a glob. */
const spawnDevServer = (dashboardDir: string, port: number): { distDir: string; server: ChildProcess } => {
  const distDir = runDistDir()
  const server = spawn('bun', ['run', 'next', 'dev', '--port', String(port)], {
    cwd: dashboardDir,
    // biome-ignore lint/style/noProcessEnv: NEXT_DIST_DIR is the deliberate run-owned build-dir seam next.config.ts reads
    env: { ...process.env, NEXT_DIST_DIR: distDir },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  return { distDir, server }
}
/** Removes only this run's dist dir, addressed by its exact path. */
const cleanDistDir = async (dashboardDir: string, distDir: string): Promise<void> => {
  await rm(join(dashboardDir, distDir), { force: true, recursive: true })
}
export { cleanDistDir, spawnDevServer }
