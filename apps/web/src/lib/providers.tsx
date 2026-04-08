'use client'
/* eslint-disable react/hook-use-state */
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
const Providers = ({ children }: { children: ReactNode }) => {
  const [qc] = useState(() => new QueryClient())
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}
export { Providers }
