import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRenderSession, startServe } from '@elah/cli'

const here = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(here, '..', 'assets')

async function main(): Promise<void> {
  const session = createRenderSession()
  await session.warmup()

  const handle = await startServe({
    host: '127.0.0.1',
    port: 8080,
    concurrency: 1,
    mediaRoot: assetsDir,
    session,
    render: {},
    log: (line) => console.error(line),
  })

  console.log(`listening on http://127.0.0.1:${handle.port} (media root ${assetsDir})`)
  console.log('try: curl -X POST --data-binary @spec.json http://127.0.0.1:8080/render -o out.mp4')

  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) process.exit(130)
    shuttingDown = true
    console.error('shutting down...')
    void handle
      .close()
      .then(() => session.close())
      .then(() => process.exit(0))
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
