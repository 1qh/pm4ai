import Link from 'next/link'
const Page = () => (
  <div className='flex flex-1 flex-col items-center justify-center gap-8 px-4'>
    <h1 className='text-6xl font-extrabold tracking-tighter'>pkgname</h1>
    {/* biome-ignore lint/nursery/noTailwindRestyledComponents: next/link renders an unstyled anchor */}
    <Link className='bg-primary text-primary-foreground rounded-full px-8 py-3 text-sm font-semibold' href='/docs'>
      Get Started
    </Link>
  </div>
)
export { Page as default }
