/** biome-ignore-all lint/nursery/noUndeclaredClasses: standard tailwind v4 utilities biome cannot resolve */
import type { Metadata } from 'next'
import { cn } from '@a/ui'
import { mono, sans } from './fonts'
import './global.css'
import { Providers } from './providers'
const metadata: Metadata = {
  title: 'pm4ai docs'
}
const Layout = ({ children }: LayoutProps<'/'>) => (
  <html className={cn('font-sans tracking-[-0.02em]', sans.variable, mono.variable)} lang='en' suppressHydrationWarning>
    <body className='flex min-h-screen flex-col antialiased'>
      <Providers>{children}</Providers>
    </body>
  </html>
)
export { metadata }
export default Layout
