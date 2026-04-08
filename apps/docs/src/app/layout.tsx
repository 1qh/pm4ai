import { cn } from '@a/ui'
import { mono, sans } from './fonts'
import './global.css'
import { Providers } from './providers'
export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html className={cn('font-sans', sans.variable, mono.variable)} lang='en' suppressHydrationWarning>
      <body className='flex flex-col min-h-screen'>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
