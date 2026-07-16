import { homedir } from 'node:os'
import { join } from 'node:path'
import { CONFIG_DIR } from './config-dir.js'
/** Overridable so a caller — or a test — binds somewhere other than the real home: the path is a host-wide singleton, so two processes sharing it fight over one socket. */
// biome-ignore lint/style/noProcessEnv: the socket dir is deliberately configurable
const SOCKET_DIR = process.env.PM4AI_SOCKET_DIR ?? join(homedir(), CONFIG_DIR)
const SOCKET_PATH = join(SOCKET_DIR, 'watch.sock')
export { SOCKET_DIR, SOCKET_PATH }
