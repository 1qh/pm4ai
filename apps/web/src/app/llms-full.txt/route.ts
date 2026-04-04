import { guide } from 'pm4ai/guide'
import { source } from '@/lib/source'
const ecosystem = `## Ecosystem
All projects with lintmax in deps are managed by pm4ai. The tool syncs configs, generates CLAUDE.md, enforces conventions, and runs maintenance.
Key repos:
- pm4ai — the management tool. Rules in apps/web/content/rules/*.mdx. Checks in packages/pm4ai/src/.
- lintmax — max-strict lint/format orchestrator. All projects depend on it.
- cnsync — canonical source for readonly/ui (shadcn + ai-elements components).
Owner workflow:
- bunx pm4ai@latest status — check current project
- bunx pm4ai@latest fix — sync + maintain (requires clean git)
- bunx pm4ai@latest fix --all — all projects
- sh up.sh — clean + install + build + fix + check
When to improve pm4ai:
- New universal rule → add .mdx to apps/web/content/rules/ with infer frontmatter
- New check → add to packages/pm4ai/src/audit.ts or checks.ts
- New dotfile → add to VERBATIM_FILES in constants.ts and repo root
- After changes: fix, check, test, commit, push, publish, then pm4ai fix --all
Start prompt for new sessions:
  Read https://pm4ai.vercel.app/llms-full.txt first.
  Run bunx pm4ai@latest status.
  If you discover something that should apply to all projects, note it for pm4ai.
`
export const GET = async () => {
  const pages = source.getPages()
  const sections: string[] = [guide, '', '---', '', ecosystem, '---', '']
  const contents = await Promise.all(pages.map(async page => page.data.getText('processed')))
  for (const [i, page] of pages.entries()) {
    sections.push(`## ${page.data.title}`)
    sections.push('')
    sections.push(contents[i] ?? '')
    sections.push('')
  }
  return new Response(sections.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  })
}
