import { Inter, JetBrains_Mono } from 'next/font/google'
import './global.css'
import { Providers } from './providers'
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })
const fonts = `${inter.variable} ${jetbrainsMono.variable}`
export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html className={fonts} lang='en' suppressHydrationWarning>
      <body className='flex flex-col min-h-screen font-[family-name:var(--font-inter)]'>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
