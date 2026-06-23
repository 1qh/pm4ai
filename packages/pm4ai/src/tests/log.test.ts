import { describe, expect, test } from 'bun:test'
import { readLog, updateLog } from '../log.js'

describe('updateLog + readLog', () => {
  test('writes and reads back a log entry', async () => {
    const entry = { at: new Date().toISOString(), pass: true, path: '/tmp/test-project', project: 'test-project' }
    await updateLog(entry)
    const logs = await readLog()
    const found = logs.find(e => e.project === 'test-project')
    expect(found).toBeDefined()
    expect(found?.pass).toBe(true)
  })
  test('overwrites entry for same project path', async () => {
    const entry1 = { at: new Date().toISOString(), pass: true, path: '/tmp/overwrite-test', project: 'overwrite-test' }
    await updateLog(entry1)
    const entry2 = {
      at: new Date().toISOString(),
      error: 'failed',
      pass: false,
      path: '/tmp/overwrite-test',
      project: 'overwrite-test'
    }
    await updateLog(entry2)
    const logs = await readLog()
    const found = logs.filter(e => e.path === '/tmp/overwrite-test')
    expect(found).toHaveLength(1)
    expect(found[0]?.pass).toBe(false)
  })
  test('different paths do not collide', async () => {
    const entry1 = { at: new Date().toISOString(), pass: true, path: '/a/project', project: 'project' }
    const entry2 = { at: new Date().toISOString(), pass: false, path: '/b/project', project: 'project' }
    await updateLog(entry1)
    await updateLog(entry2)
    const logs = await readLog()
    const a = logs.find(e => e.path === '/a/project')
    const b = logs.find(e => e.path === '/b/project')
    expect(a?.pass).toBe(true)
    expect(b?.pass).toBe(false)
  })
  test('stores error message on failure', async () => {
    const entry = {
      at: new Date().toISOString(),
      error: 'lint failed with 3 errors',
      pass: false,
      path: '/tmp/error-log-test',
      project: 'error-log-test'
    }
    await updateLog(entry)
    const logs = await readLog()
    const found = logs.find(e => e.project === 'error-log-test')
    expect(found?.error).toBe('lint failed with 3 errors')
  })
  test('entry has valid ISO timestamp', async () => {
    const entry = { at: new Date().toISOString(), pass: true, path: '/tmp/ts-test', project: 'ts-test' }
    await updateLog(entry)
    const logs = await readLog()
    const found = logs.find(e => e.project === 'ts-test')
    expect(new Date(found?.at ?? '').getTime()).not.toBeNaN()
  })
})
