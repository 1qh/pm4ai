import { createServer } from 'node:net'
/** Asks the OS for an unused port instead of hardcoding one: a fixed port is a host-wide singleton, so a CI runner and a local shell on the same machine race each other for the bind and one of them fails to start. */
const freePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer()
    srv.on('error', reject)
    srv.listen(0, () => {
      const addr = srv.address()
      if (addr === null || typeof addr === 'string') {
        reject(new Error('server address is not a TCP address'))
        return
      }
      const { port } = addr
      srv.close(() => {
        resolve(port)
      })
    })
  })
export { freePort }
