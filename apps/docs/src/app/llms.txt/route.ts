import { guide } from 'pm4ai/guide'
import { source } from '@/lib/source'
export const GET = () => {
  const pages = source.getPages()
  const lines = [
    guide,
    '',
    '## Rules',
    '',
    ...pages.map(page => `- [${page.data.title}](${page.url}): ${page.data.description ?? ''}`)
  ]
  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  })
}
