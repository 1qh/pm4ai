import Link from 'next/link'
const Page = () => (
  <div className='flex flex-1 flex-col items-center justify-center gap-8 overflow-hidden px-4'>
    <h1 className='text-6xl font-extrabold tracking-tighter'>pm4ai</h1>
    <p className='text-muted-foreground text-2xl whitespace-nowrap'>
      Agent-first anti-slop project management for TypeScript monorepos
    </p>
    <code className='bg-muted rounded-lg px-4 py-2 text-sm'>bunx pm4ai@latest status</code>
    <Link
      // biome-ignore lint/nursery/noTailwindRestyledComponents: next/link renders an unstyled anchor
      className='bg-primary text-primary-foreground rounded-full px-8 py-3 text-sm font-semibold transition-opacity hover:opacity-90'
      href='/docs'>
      Get Started
    </Link>
  </div>
)
export { Page as default }
