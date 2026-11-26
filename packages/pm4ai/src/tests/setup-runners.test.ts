import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { nextRunnerName, runnerBase } from '../setup-runners.js'
describe('runner names', () => {
  test.each([
    { expected: '1', names: [], title: 'starts at one' },
    { expected: '2', names: ['1'], title: 'uses the next available number' },
    { expected: '3', names: ['1', '2', '4'], title: 'fills the lowest gap' },
    { expected: '1', names: ['2', '3', 'project-mac'], title: 'reuses an available one' },
    { expected: '2', names: ['3', '1', 'host-mac', '01', '0'], title: 'ignores order and noncanonical names' },
    { expected: '11', names: Array.from({ length: 10 }, (_, i) => String(i + 1)), title: 'supports multiple digits' }
  ])('$title', ({ expected, names }) => {
    expect(nextRunnerName(names)).toBe(expected)
  })
  test('generated name is a bare positive integer without host name components', () => {
    const hostName = 'alex-private-macbook.local'
    const name = nextRunnerName([hostName, 'project-mac', '1'])
    expect(name).toMatch(/^[1-9]\d*$/v)
    for (const part of hostName.replaceAll('.', '-').split('-')) expect(name).not.toContain(part)
  })
})
const HOME = join('home', 'runner')
describe('runner installation directories', () => {
  test('uses the repo and selected numeric name beneath the runners directory', () => {
    const name = nextRunnerName(['1', '2', '4'])
    expect(runnerBase('owner/project', name, HOME)).toBe(join(HOME, '.actions-runners', 'project', '3'))
  })
  test('allocates numbers independently for each repo', () => {
    expect(runnerBase('owner/first', nextRunnerName(['1']), HOME)).toBe(join(HOME, '.actions-runners', 'first', '2'))
    expect(runnerBase('owner/second', nextRunnerName([]), HOME)).toBe(join(HOME, '.actions-runners', 'second', '1'))
  })
})
