'use client'
import type { ReactNode } from 'react'
import { RootProvider } from 'fumadocs-ui/provider/next'
const Providers = ({ children }: { children: ReactNode }) => <RootProvider>{children}</RootProvider>
export { Providers }
