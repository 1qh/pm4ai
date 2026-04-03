import { createSearchAPI } from 'fumadocs-core/search/server'
import { source } from '@/lib/source'
export const { GET } = createSearchAPI('advanced', {
  indexes: source.getPages().map(page => ({
    description: page.data.description,
    id: page.url,
    structuredData: page.data.structuredData,
    title: page.data.title,
    url: page.url
  }))
})
