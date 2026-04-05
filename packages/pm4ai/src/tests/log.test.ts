import { describe, expect, test } from 'bun:test'
import { readLog, updateLog } from '../log.js'
describe('updateLog + readLog', () => {
  test('writes and reads back a log entry', () => {
    const entry = { at: new Date().toISOString(), pass: true, path: '/tmp/test-project', project: 'test-project' }
    updateLog(entry)
    const logs = readLog()
    const found = logs.find(e => e.project === 'test-project')
    expect(found).toBeDefined()
    expect(found?.pass).toBe(true)
  })
  test('overwrites entry for same project path', () => {
    const entry1 = { at: new Date().toISOString(), pass: true, path: '/tmp/overwrite-test', project: 'overwrite-test' }
    updateLog(entry1)
    const entry2 = {
      at: new Date().toISOString(),
      error: 'failed',
      pass: false,
      path: '/tmp/overwrite-test',
      project: 'overwrite-test'
    }
    updateLog(entry2)
    const logs = readLog()
    const found = logs.filter(e => e.path === '/tmp/overwrite-test')
    expect(found).toHaveLength(1)
    expect(found[0]?.pass).toBe(false)
  })
  test('different paths do not collide', () => {
    const entry1 = { at: new Date().toISOString(), pass: true, path: '/a/project', project: 'project' }
    const entry2 = { at: new Date().toISOString(), pass: false, path: '/b/project', project: 'project' }
    updateLog(entry1)
    updateLog(entry2)
    const logs = readLog()
    const a = logs.find(e => e.path === '/a/project')
    const b = logs.find(e => e.path === '/b/project')
    expect(a?.pass).toBe(true)
    expect(b?.pass).toBe(false)
  })
})
