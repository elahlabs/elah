import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, exportProject, CliError } from '@elah/cli'
import { buildExampleSpec } from './example-spec'

const here = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(here, '..', 'assets')
const outPath = join(here, '..', 'output', 'example.mp4')

async function main(): Promise<void> {
  const spec = await buildExampleSpec(assetsDir)
  const { project, summary } = await build({ spec, baseDir: assetsDir })
  console.log(`built project: ${summary.clips} clips, ${summary.totalFrames} frames @ ${summary.fps}fps`)

  mkdirSync(dirname(outPath), { recursive: true })
  await exportProject(
    { project, outPath },
    { onProgress: ({ frame, totalFrames }) => process.stdout.write(`\rrendering ${frame}/${totalFrames}`) }
  )
  process.stdout.write('\n')
  console.log(`wrote ${outPath}`)
}

main().catch((err: unknown) => {
  if (err instanceof CliError) {
    console.error(err.message)
  } else {
    console.error(err)
  }
  process.exit(1)
})
