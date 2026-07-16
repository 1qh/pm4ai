import { homedir } from 'node:os'
import { join } from 'node:path'
import { CONFIG_DIR } from './config-dir.js'
/** Overridable so a caller — or a test — puts its state somewhere other than the real home: everything under here is a host-wide singleton, so two runs sharing it fight over one socket, one lock, one cache. Stands alone (no disk reads at import) so a bundled consumer can import it. */
// biome-ignore lint/style/noProcessEnv: the state dir is deliberately configurable
const stateDir = (): string => process.env.PM4AI_STATE_DIR ?? join(homedir(), CONFIG_DIR)
const statePath = (...parts: string[]): string => join(stateDir(), ...parts)
export { stateDir, statePath }
