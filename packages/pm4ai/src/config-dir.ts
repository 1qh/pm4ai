/** Stands alone so a bundled consumer can read it without pulling constants.ts, which reads package.json off disk at module scope and throws once bundled. */
const CONFIG_DIR = '.pm4ai'
export { CONFIG_DIR }
