import { RPCHandler } from '@orpc/server/fetch'
import { router } from '@/lib/router'
const handler = new RPCHandler(router)
const handle = async (req: Request) => {
  const url = new URL(req.url)
  const rpcUrl = new URL(url.pathname.replace('/api/rpc', ''), url.origin)
  rpcUrl.search = url.search
  const rpcReq = new Request(rpcUrl, req)
  const result = await handler.handle(rpcReq, {
    context: { headers: req.headers }
  })
  return result.matched ? result.response : new Response('Not found', { status: 404 })
}
export { handle as GET, handle as POST }
