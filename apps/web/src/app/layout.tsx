import { RootProvider } from 'fumadocs-ui/provider/next'
import './global.css'
import { Inter, JetBrains_Mono } from 'next/font/google'
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })
export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html className={`${inter.variable} ${jetbrainsMono.variable}`} lang='en' suppressHydrationWarning>
      <body className='flex flex-col min-h-screen font-[family-name:var(--font-inter)]'>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}
