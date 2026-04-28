/* oxlint-disable eslint-plugin-react(forbid-component-props) */
import Link from 'next/link'
const Page = () => (
  <div className='flex flex-1 flex-col items-center justify-center gap-8 px-4'>
    <h1 className='text-6xl font-extrabold tracking-tighter'>__NAME__</h1>
    <Link className='rounded-full bg-fd-primary px-8 py-3 text-sm font-semibold text-fd-primary-foreground' href='/docs'>
      Get Started
    </Link>
  </div>
)
export default Page
