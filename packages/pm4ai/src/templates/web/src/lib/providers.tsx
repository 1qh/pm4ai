'use client'
import type { ReactNode } from 'react'
import { Toaster } from '@a/ui/components/sonner'
import { TooltipProvider } from '@a/ui/components/tooltip'
const Providers = ({ children }: { children: ReactNode }) => (
  <TooltipProvider>
    {children}
    <Toaster />
  </TooltipProvider>
)
export { Providers }
