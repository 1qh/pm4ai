import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { cn } from '@a/ui'
import { ThemeProvider } from 'next-themes'
import { Providers } from '@/lib/providers'
import { mono, sans } from './fonts'
import './globals.css'
const metadata: Metadata = {
  description: 'Real-time project monitoring dashboard',
  title: 'pm4ai dashboard'
}
const RootLayout = ({ children }: { children: ReactNode }) => (
  <html className={cn('font-sans tracking-[-0.02em]', sans.variable, mono.variable)} lang='en' suppressHydrationWarning>
    <body className='min-h-screen antialiased'>
      <ThemeProvider attribute='class' defaultTheme='dark' disableTransitionOnChange enableSystem={false}>
        <Providers>{children}</Providers>
      </ThemeProvider>
    </body>
  </html>
)
export default RootLayout
export { metadata }
