// biome-ignore lint/style/noProcessEnv: this module is the single env boundary; all other reads go through the typed accessors below
const raw = process.env
/** Search root for project discovery; bounds scanning to an isolated dir in tests/constrained hosts. */
const pm4aiHome = (): string | undefined => raw.PM4AI_HOME
/** Clone source for the self/cnsync source repos; tests point it at a local bare repo. */
const pm4aiCloneBase = (): string | undefined => raw.PM4AI_CLONE_BASE
/** State directory (locks, caches, source repos); overridable so a run owns an isolated singleton. */
const pm4aiStateDir = (): string | undefined => raw.PM4AI_STATE_DIR
export { pm4aiCloneBase, pm4aiHome, pm4aiStateDir }
