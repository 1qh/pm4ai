/* eslint-disable no-console */
import { $ } from 'bun'
import { discover } from './discover.js'
import { isNestedInRepo } from './utils.js'

const AHEAD_RE = /\+(?<n>\d+)/u
const BEHIND_RE = /-(?<n>\d+)/u
type ListWriter = (row: string) => void
const gitStatus = async (path: string): Promise<{ ahead: number; behind: number; dirty: boolean }> => {
  const sb = await $`git -C ${path} status -sb --porcelain=v2 --branch -- .`.quiet().nothrow()
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
const list = async (
  excludes: readonly string[] = [],
  searchRoot?: string,
  write: ListWriter = row => console.log(row)
): Promise<void> => {
  const { consumers } = await discover(searchRoot, excludes, false)
  const rows = await Promise.all(
    consumers.map(async c => {
      const g = await gitStatus(c.path)
      const nested = await isNestedInRepo(c.path)
      const counts: string[] = []
      if (!nested) {
        if (g.behind) counts.push(`behind:${g.behind}`)
        if (g.ahead) counts.push(`ahead:${g.ahead}`)
      }
      const flags = [
        g.dirty ? 'dirty' : 'clean',
        nested ? 'upstream counts skipped: not a repository root' : '',
        ...counts
      ]
        .filter(Boolean)
        .join(',')
      return `${c.path}\t${flags}`
    })
  )
  for (const r of rows.toSorted((a, b) => (a < b ? -1 : Number(a > b)))) write(r)
}
export { list }
