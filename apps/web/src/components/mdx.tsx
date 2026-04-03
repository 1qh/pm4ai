import type { MDXComponents } from 'mdx/types'
import defaultMdxComponents from 'fumadocs-ui/mdx'
const getMDXComponents = (components?: MDXComponents): MDXComponents => ({
  ...defaultMdxComponents,
  ...components
})
const useMDXComponents = getMDXComponents
declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>
}
export { getMDXComponents, useMDXComponents }
