import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { cn } from '@a/ui'
import { Providers } from '@/lib/providers'
import { mono, sans } from './fonts'
import './global.css'
const metadata: Metadata = {
  description: 'Real-time project monitoring dashboard',
  title: 'pm4ai dashboard'
}
const Layout = ({ children }: { children: ReactNode }) => (
  <html className={cn('font-sans tracking-[-0.02em]', sans.variable, mono.variable)} lang='en' suppressHydrationWarning>
    <body className='min-h-screen antialiased'>
      <Providers>{children}</Providers>
    </body>
  </html>
)
export default Layout
export { metadata }
