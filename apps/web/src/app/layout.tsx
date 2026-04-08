/* eslint-disable @eslint-react/no-unused-props, react/no-unused-prop-types, @typescript-eslint/require-await */
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Providers } from '@/lib/providers'
import './globals.css'
const metadata: Metadata = {
  description: 'Real-time project monitoring dashboard',
  title: 'pm4ai dashboard'
}
const RootLayout = async ({ children }: { children: ReactNode; params: Promise<Record<string, string>> }) => (
  <html lang='en'>
    <body className='bg-neutral-950 text-neutral-100 font-mono antialiased'>
      <Providers>{children}</Providers>
    </body>
  </html>
)
export default RootLayout
export { metadata }
