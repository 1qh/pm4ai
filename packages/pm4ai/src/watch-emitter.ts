/** biome-ignore-all lint/suspicious/noEmptyBlockStatements: intentional catch-swallow */
/* oxlint-disable no-empty-function, eslint-plugin-promise(prefer-await-to-then) */
/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/strict-void-return */
import type { Server, Socket } from 'node:net'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { WatchEvent } from './watch-types.js'
const SOCKET_DIR = join(homedir(), '.pm4ai')
const SOCKET_PATH = join(SOCKET_DIR, 'watch.sock')
type Listener = (event: WatchEvent) => void
const clients = new Set<Socket>()
const listeners = new Set<Listener>()
let server: Server | undefined
const removeSocket = () => {
  try {
    unlinkSync(SOCKET_PATH)
  } catch {
    /* Socket may not exist */
  }
}
const broadcast = (line: string, exclude?: Socket) => {
  const msg = `${line}\n`
  for (const client of clients)
    if (client !== exclude)
      try {
        client.write(msg)
      } catch {
        /* Client may be disconnecting */
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
      let buffer = ''
      socket.on('data', chunk => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines)
          if (line) {
            broadcast(line, socket)
            try {
              const event = JSON.parse(line) as WatchEvent
              for (const fn of listeners) fn(event)
            } catch {
              /* Malformed JSON */
            }
          }
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
  broadcast(JSON.stringify(event))
}
const emitToSocket = (event: WatchEvent) => {
  if (!existsSync(SOCKET_PATH)) return
  try {
    const sock = createConnection(SOCKET_PATH)
    sock.on('error', () => {})
    sock.on('connect', () => {
      sock.write(`${JSON.stringify(event)}\n`)
      sock.end()
    })
  } catch {
    /* Socket not available */
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
const onEvent = (fn: Listener): (() => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export { clients, emit, emitToSocket, installCleanup, onEvent, SOCKET_PATH, startEmitter, stopEmitter }
