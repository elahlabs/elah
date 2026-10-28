/**
 * Regenerates samples/project/elah-input.json: the promo spec compiled to a Project document, wrapped as a
 * `source.kind: "project"` input. Run from the elah root: `node artifact/samples/make-project-sample.mjs`.
 */
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(join(ROOT, 'packages/cli/package.json'))
const esbuild = require('esbuild')
const tmp = join(ROOT, 'artifact/.cache')
mkdirSync(tmp, { recursive: true })
const out = join(tmp, 'spec-node.mjs')
await esbuild.build({
  stdin: { contents: "export { buildVideo } from './packages/core/src/spec/index.ts'", resolveDir: ROOT, loader: 'ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'error',
})
const { buildVideo } = await import(pathToFileURL(out).href)
const promo = JSON.parse(readFileSync(join(ROOT, 'artifact/samples/promo/elah-input.json'), 'utf8'))
const spec = { ...promo.source.spec, title: 'Notes AI launch promo (project)' }
const built = buildVideo(spec, { seed: 7 })
const project = JSON.parse(JSON.stringify(built.project))
mkdirSync(join(ROOT, 'artifact/samples/project'), { recursive: true })
writeFileSync(
  join(ROOT, 'artifact/samples/project/elah-input.json'),
  JSON.stringify({ format: 'elah-input', version: 1, title: 'Saved project (.elah.json document)', source: { kind: 'project', project } }) + '\n',
)
rmSync(tmp, { recursive: true, force: true })
console.log(`project sample: ${Object.keys(project.clips).length} tracks, ${built.issues.length} issue(s)`)
