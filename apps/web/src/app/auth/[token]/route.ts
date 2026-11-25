import { NextResponse } from 'next/server'
import { createSessionCookie, didConsumeToken } from '@/lib/auth'
export const GET = async (_req: Request, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params
  if (!didConsumeToken(token)) return new NextResponse('Unauthorized', { status: 401 })
  const res = NextResponse.redirect(new URL('/', _req.url))
  res.headers.set('Set-Cookie', createSessionCookie())
  return res
}
