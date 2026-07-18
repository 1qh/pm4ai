import { homedir } from 'node:os'
import { join } from 'node:path'
import { CONFIG_DIR } from './config-dir.js'
import { pm4aiStateDir } from './env.js'
/** Overridable so a caller — or a test — puts its state somewhere other than the real home: everything under here is a host-wide singleton, so two runs sharing it fight over one socket, one lock, one cache. Stands alone (no disk reads at import) so a bundled consumer can import it. */
const stateDir = (): string => pm4aiStateDir() ?? join(homedir(), CONFIG_DIR)
const statePath = (...parts: string[]): string => join(stateDir(), ...parts)
export { stateDir, statePath }
