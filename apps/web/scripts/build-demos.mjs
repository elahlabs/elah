#!/usr/bin/env node
/**
 * Builds the homepage demo specs (lib/demos/specs.ts) into plain project JSON
 * under lib/demos/projects/, so each demo's project is reviewable as data.
 * `lib/demos/demos.test.ts` fails when the committed JSON drifts from the specs.
 *
 *   node scripts/build-demos.mjs
 *
 * Uses the esbuild already in the root node_modules; installs nothing.
 */
import { build } from 'esbuild'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'

const web = fileURLToPath(new URL('..', import.meta.url))
const core = join(web, '../../packages/core/src')
const tmp = join(web, 'node_modules/.cache/build-demos.mjs')

await build({
  stdin: {
    contents: `
      import { compileVideoSpec } from '@elah/core/spec'
      import { heroSpec, tileSpecs, patchProject } from './lib/demos/specs'
      export function projects() {
        const out = {}
        for (const [name, spec] of Object.entries({ hero: heroSpec, ...tileSpecs })) {
          const { project, issues } = compileVideoSpec(spec)
          const errors = issues.filter((i) => i.severity === 'error')
          if (errors.length) throw new Error(name + ': ' + errors.map((e) => e.path + ' ' + e.message).join('; '))
          out[name] = patchProject(name, project)
        }
        return out
      }`,
    resolveDir: web,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: tmp,
  alias: {
    '@elah/core/spec': join(core, 'spec/index.ts'),
    '@elah/core': join(core, 'index.ts'),
  },
  logLevel: 'error',
})

const { projects } = await import(pathToFileURL(tmp).href)
const outDir = join(web, 'lib/demos/projects')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
for (const [name, project] of Object.entries(projects())) {
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(project, null, 2) + '\n')
  console.log('wrote', `lib/demos/projects/${name}.json`)
}
