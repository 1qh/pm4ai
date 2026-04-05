'use client'
import type { RouterClient } from '@orpc/server'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { createORPCReactQueryUtils } from '@orpc/react-query'
import type { router } from './router'
type AppClient = RouterClient<typeof router>
const client = createORPCClient<AppClient>(new RPCLink({ url: '/api/rpc' }))
const orpc = createORPCReactQueryUtils(client)
export { client, orpc }
