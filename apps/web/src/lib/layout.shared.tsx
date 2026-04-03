import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
import { appName } from './shared'
export const baseOptions = (): BaseLayoutProps => ({
  nav: {
    title: appName
  }
})
