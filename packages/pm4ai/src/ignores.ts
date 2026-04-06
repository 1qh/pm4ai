/* eslint-disable no-console, no-await-in-loop, prefer-named-capture-group */
/** biome-ignore-all lint/performance/noAwaitInLoops: sequential project scan */
/** biome-ignore-all lint/nursery/useNamedCaptureGroup: not needed */
import { $ } from 'bun'
import { discover } from './discover.js'
import { isInsideProject, projectName } from './utils.js'
const eslintDisableRe = /eslint-disable(?:-next-line)?\s+(.+?)(?:\s*\*\/|\s*$)/gu
const oxlintDisableRe = /oxlint-disable(?:-next-line)?\s+(.+?)(?:\s*\*\/|\s*$)/gu
const biomeIgnoreRe = /biome-ignore(?:-all)?\s+([\w/]+)/gu
const tsIgnoreRe = /@ts-(?:ignore|expect-error|nocheck)/gu
const trailingCommentRe = /\s*--.*$/u
const trailingCloseRe = /\s*\*\/$/u
const tsInlineRe = /@ts-(?:ignore|expect-error|nocheck)/u
interface IgnoreEntry {
  count: number
  files: string[]
  rule: string
}
const parseRules = (line: string, re: RegExp): string[] => {
  const rules: string[] = []
  re.lastIndex = 0
  let match = re.exec(line)
  while (match) {
    const raw = match[1]
    if (raw)
      for (const r of raw.split(',')) {
        const trimmed = r.trim().replace(trailingCommentRe, '').replace(trailingCloseRe, '')
        if (trimmed) rules.push(trimmed)
      }
    match = re.exec(line)
  }
  return rules
}
const scanProject = async (projectPath: string): Promise<Map<string, Set<string>>> => {
  const ruleFiles = new Map<string, Set<string>>()
  const add = (rule: string, file: string) => {
    const existing = ruleFiles.get(rule)
    if (existing) existing.add(file)
    else ruleFiles.set(rule, new Set([file]))
  }
  const result =
    await $`rg -n "eslint-disable|oxlint-disable|biome-ignore|@ts-ignore|@ts-expect-error|@ts-nocheck" ${projectPath} -g '*.ts' -g '*.tsx' -g '!node_modules' -g '!readonly' -g '!.next' -g '!dist' -g '!build' -g '!_generated' -g '!generated' -g '!module_bindings' -g '!.source' -g '!*.d.ts' --no-filename`
      .quiet()
      .nothrow()
  const lines = result.stdout.toString().trim().split('\n').filter(Boolean)
  for (const line of lines) {
    const file = line.split(':')[0] ?? ''
    const content = line.slice(line.indexOf(':') + 1)
    for (const rule of parseRules(content, eslintDisableRe)) add(rule, file)
    for (const rule of parseRules(content, oxlintDisableRe)) add(rule, file)
    for (const rule of parseRules(content, biomeIgnoreRe)) add(rule, file)
    tsIgnoreRe.lastIndex = 0
    if (tsIgnoreRe.test(content)) {
      const tsMatch = tsInlineRe.exec(content)
      if (tsMatch) add(tsMatch[0], file)
    }
  }
  return ruleFiles
}
const formatResults = (projectPath: string, ruleFiles: Map<string, Set<string>>): string => {
  if (ruleFiles.size === 0) return `${projectName(projectPath)}: no suppressions`
  const entries: IgnoreEntry[] = [...ruleFiles.entries()]
    .map(([rule, files]) => ({ count: files.size, files: [...files], rule }))
    .toSorted((a, b) => b.count - a.count)
  const total = entries.reduce((sum, e) => sum + e.count, 0)
  const maxRule = Math.max(...entries.map(e => e.rule.length))
  const lines = [`${projectName(projectPath)} — ${total} suppressions across ${entries.length} rules`, '']
  for (const e of entries) lines.push(`  ${e.rule.padEnd(maxRule)}  ${String(e.count).padStart(3)}`)
  return lines.join('\n')
}
const ignores = async (all = false, verbose = false) => {
  let projects: { name: string; path: string }[]
  if (all) {
    const { consumers, self, cnsync } = await discover()
    projects = [self, cnsync, ...consumers]
  } else {
    const projectPath = await isInsideProject()
    if (projectPath) projects = [{ name: projectName(projectPath), path: projectPath }]
    else {
      const { consumers, self, cnsync } = await discover()
      projects = [self, cnsync, ...consumers]
    }
  }
  for (const project of projects) {
    const ruleFiles = await scanProject(project.path)
    console.log(formatResults(project.path, ruleFiles))
    if (verbose && ruleFiles.size > 0) {
      const entries = [...ruleFiles.entries()].toSorted((a, b) => b[1].size - a[1].size)
      for (const [rule, files] of entries) {
        console.log(`\n  ${rule}:`)
        for (const f of files) console.log(`    ${f.replace(`${project.path}/`, '')}`)
      }
    }
    console.log()
  }
}
export { ignores, parseRules, scanProject }
