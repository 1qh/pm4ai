'use client'
/* eslint-disable react/hook-use-state */
import type { ReactNode } from 'react'
import { Toaster } from '@a/ui/components/sonner'
import { TooltipProvider } from '@a/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useState } from 'react'
const Providers = ({ children }: { children: ReactNode }) => {
  const [qc] = useState(() => new QueryClient())
  return (
    <ThemeProvider attribute='class' defaultTheme='dark' disableTransitionOnChange enableSystem={false}>
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          {children}
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
export { Providers }
