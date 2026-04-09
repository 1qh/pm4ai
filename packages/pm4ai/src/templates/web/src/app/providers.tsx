'use client'
import type { ReactNode } from 'react'
import { Toaster } from '@a/ui/components/sonner'
import { TooltipProvider } from '@a/ui/components/tooltip'
import { ThemeProvider } from 'next-themes'
const Providers = ({ children }: { children: ReactNode }) => (
  <ThemeProvider attribute='class' defaultTheme='dark' disableTransitionOnChange enableSystem={false}>
    <TooltipProvider>
      {children}
      <Toaster />
    </TooltipProvider>
  </ThemeProvider>
)
export { Providers }
