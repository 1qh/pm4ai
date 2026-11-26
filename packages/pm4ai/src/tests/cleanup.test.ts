import { describe, expect, test } from 'bun:test'
import { isRetired, versionsToRetire } from '../cleanup.js'
describe('versionsToRetire', () => {
  test('selects only versions without deprecation and excludes the current version', () => {
    const document = { versions: { '1': { deprecated: 'x' }, '2': {}, '3': {} } }
    expect(versionsToRetire(document, '3')).toStrictEqual(['2'])
  })
  test('selects nothing when only the current version exists', () => {
    expect(versionsToRetire({ versions: { '3': {} } }, '3')).toStrictEqual([])
  })
})
describe('isRetired', () => {
  test('confirms deprecated and absent versions while rejecting live versions', () => {
    const document = { versions: { '1': { deprecated: 'x' }, '2': {} } }
    expect(['1', '2', '3'].map(v => isRetired(document, v))).toStrictEqual([true, false, true])
  })
})
