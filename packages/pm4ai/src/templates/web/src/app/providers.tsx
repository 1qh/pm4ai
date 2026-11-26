'use client'
import type { ReactNode } from 'react'
import { Toaster } from '@a/ui/components/toast'
import { TooltipProvider } from '@a/ui/components/tooltip'
import { ThemeProvider } from 'next-themes'
const Providers = ({ children }: { children: ReactNode }) => (
  <ThemeProvider attribute='class' defaultTheme='dark' disableTransitionOnChange enableSystem={false}>
    <TooltipProvider>
      <Toaster>{children}</Toaster>
    </TooltipProvider>
  </ThemeProvider>
)
export { Providers }
