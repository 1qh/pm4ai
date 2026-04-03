import { source } from '@/lib/source'
export const GET = async () => {
  const pages = source.getPages()
  const sections: string[] = ['# pm4ai', '']
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
