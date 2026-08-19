import { join } from 'node:path'
import { stateDir } from './state-dir.js'
const SOCKET_DIR = stateDir()
const SOCKET_PATH = join(SOCKET_DIR, 'watch.sock')
export { SOCKET_DIR, SOCKET_PATH }
