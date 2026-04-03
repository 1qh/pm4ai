import Link from 'next/link'
export default function HomePage() {
  return (
    <div className='flex flex-col items-center justify-center flex-1 gap-6 px-4 overflow-hidden'>
      <h1 className='text-6xl font-extrabold tracking-tighter'>pm4ai</h1>
      <p className='text-xl text-fd-muted-foreground leading-relaxed max-w-lg text-center'>Documentation</p>
      <Link
        className='rounded-full bg-fd-primary text-fd-primary-foreground px-8 py-3 font-semibold text-sm hover:opacity-90 transition-opacity'
        href='/docs'>
        Get Started
      </Link>
    </div>
  )
}
