import type { Metadata } from 'next'
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page'
import { createRelativeLink } from 'fumadocs-ui/mdx'
import { notFound } from 'next/navigation'
import { getMDXComponents } from '@/components/mdx'
import { source } from '@/lib/source'
const Page = async ({ params: paramsPromise }: PageProps<'/docs/[[...slug]]'>) => {
  const params = await paramsPromise
  const page = source.getPage(params.slug)
  if (!page) notFound()
  const Content = page.data.body
  return (
    <DocsPage full={page.data.full} toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <Content
          components={getMDXComponents({
            a: createRelativeLink(source, page)
          })}
        />
      </DocsBody>
    </DocsPage>
  )
}
export default Page
export const generateStaticParams = () => source.generateParams()
export const generateMetadata = async ({ params: paramsPromise }: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> => {
  const params = await paramsPromise
  const page = source.getPage(params.slug)
  if (!page) notFound()
  return {
    description: page.data.description,
    title: page.data.title
  }
}
