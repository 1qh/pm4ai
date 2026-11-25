/** biome-ignore-all lint/nursery/noTestHooks: this is the bunfig [test] preload, not a test file; the global exitCode reset after every test is the documented guard against bun keeping a leaked process.exitCode = 1 and failing a suite whose tests all pass */
/** biome-ignore-all lint/nursery/useTopLevelDescribe: a preload registers a hook for every test file in the run, so it cannot sit inside a describe without scoping it to one block */
import { afterEach } from 'bun:test'
afterEach(() => {
  process.exitCode = 0
})
