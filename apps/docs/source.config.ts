import { metaSchema, pageSchema } from 'fumadocs-core/source/schema'
import { defineConfig, defineDocs } from 'fumadocs-mdx/config'
export const docs = defineDocs({
  dir: 'content/rules',
  docs: {
    postprocess: {
      includeProcessedMarkdown: true
    },
    schema: pageSchema
  },
  meta: {
    schema: metaSchema
  }
})
export default defineConfig({})
