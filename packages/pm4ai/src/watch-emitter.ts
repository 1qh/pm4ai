/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: intentional catch-swallow */
/* oxlint-disable no-empty-function, eslint-plugin-promise(prefer-await-to-then) */
/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/strict-void-return */
import type { Server, Socket } from 'node:net'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { WatchEvent } from './watch-types.js'
const SOCKET_DIR = join(homedir(), '.pm4ai')
const SOCKET_PATH = join(SOCKET_DIR, 'watch.sock')
const clients = new Set<Socket>()
let server: Server | undefined
const removeSocket = () => {
  try {
    unlinkSync(SOCKET_PATH)
  } catch {
    /* Socket may not exist */
  }
}
const startEmitter = async (): Promise<void> => {
  if (server) return
  mkdirSync(SOCKET_DIR, { recursive: true })
  if (existsSync(SOCKET_PATH)) removeSocket()
  await new Promise<void>((resolve, reject) => {
    const s = createServer(socket => {
      clients.add(socket)
      socket.on('close', () => clients.delete(socket))
      socket.on('error', () => clients.delete(socket))
      socket.on('data', () => {
        /* Ignore client data */
      })
    })
    s.on('error', reject)
    s.listen(SOCKET_PATH, () => {
      server = s
      resolve()
    })
  })
}
const stopEmitter = async (): Promise<void> => {
  if (!server) return
  const s = server
  server = undefined
  for (const c of clients) c.destroy()
  clients.clear()
  await new Promise<void>(resolve => {
    s.close(() => {
      removeSocket()
      resolve()
    })
  })
}
const emit = (event: WatchEvent) => {
  if (clients.size === 0) return
  const line = `${JSON.stringify(event)}\n`
  for (const client of clients)
    try {
      client.write(line)
    } catch {
      /* Client may be disconnecting */
    }
}
const cleanupOnExit = () => {
  stopEmitter().catch(() => {})
}
const installCleanup = () => {
  process.on('exit', () => {
    if (server) {
      for (const c of clients) c.destroy()
      clients.clear()
      server.close()
      removeSocket()
    }
  })
  process.on('SIGINT', () => {
    cleanupOnExit()
    process.exit(130)
  })
  process.on('SIGTERM', () => {
    cleanupOnExit()
    process.exit(143)
  })
}
export { clients, emit, installCleanup, SOCKET_PATH, startEmitter, stopEmitter }
