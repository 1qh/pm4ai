/* eslint-disable no-console */
import { $ } from 'bun'
import { discover } from './discover.js'

const AHEAD_RE = /\+(?<n>\d+)/u
const BEHIND_RE = /-(?<n>\d+)/u
const gitStatus = async (path: string): Promise<{ ahead: number; behind: number; dirty: boolean }> => {
  const sb = await $`git -C ${path} status -sb --porcelain=v2 --branch`.quiet().nothrow()
  const out = sb.stdout.toString()
  const aheadMatch = AHEAD_RE.exec(out)
  const behindMatch = BEHIND_RE.exec(out)
  const dirty = out.split('\n').some(l => l.startsWith('1 ') || l.startsWith('2 ') || l.startsWith('?'))
  return {
    ahead: aheadMatch ? Number(aheadMatch.groups?.n) : 0,
    behind: behindMatch ? Number(behindMatch.groups?.n) : 0,
    dirty
  }
}
const list = async (): Promise<void> => {
  const { consumers } = await discover()
  const rows = await Promise.all(
    consumers.map(async c => {
      const g = await gitStatus(c.path)
      const flags = [g.dirty ? 'dirty' : 'clean', g.behind ? `behind:${g.behind}` : '', g.ahead ? `ahead:${g.ahead}` : '']
        .filter(Boolean)
        .join(',')
      return `${c.path}\t${flags}`
    })
  )
  for (const r of rows.toSorted()) console.log(r)
}
export { list }
