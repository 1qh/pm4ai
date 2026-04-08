'use client'
/* eslint-disable react/hook-use-state */
import type { ReactNode } from 'react'
import { Toaster } from '@a/ui/components/sonner'
import { TooltipProvider } from '@a/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
const Providers = ({ children }: { children: ReactNode }) => {
  const [qc] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
export { Providers }
