// Stage the Elah artifact page for publishing. Plain Node, no install.
//
//   node stage.mjs <work-folder>
//
// Copies the plugin's assets/artifact/** into <work-folder> (the Artifact tool only reads files under the
// working directory or the scratchpad, and the plugin lives elsewhere) and prints one JSON object:
//   { "workFolder": "...", "file_path": "<work-folder>/index.html",
//     "files": { "<published path>": "<local path>", ... } }
// `files` lists every path in MANIFEST.json except index.html. Add "elah-input.json" yourself.
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const assets = resolve(here, '..', 'assets', 'artifact')
const target = process.argv[2]

if (!target) {
  process.stderr.write('usage: node stage.mjs <work-folder>\n')
  process.exit(2)
}
if (!existsSync(join(assets, 'MANIFEST.json')) || !existsSync(join(assets, 'index.html'))) {
  process.stderr.write(`The Elah artifact page is not in this plugin (${assets} has no index.html and MANIFEST.json). The plugin needs rebuilding: node plugins/elah/build.mjs in the Elah repo.\n`)
  process.exit(1)
}

const work = resolve(target)
mkdirSync(work, { recursive: true })
cpSync(assets, work, { recursive: true })

const manifest = JSON.parse(readFileSync(join(assets, 'MANIFEST.json'), 'utf8').replace(/^﻿/, ''))
const list = Array.isArray(manifest) ? manifest : Array.isArray(manifest.files) ? manifest.files : []
const paths = list.map((f) => (typeof f === 'string' ? f : f.path)).filter((p) => typeof p === 'string')
const files = {}
const missing = []
for (const p of paths) {
  if (p === 'index.html') continue
  const local = join(work, p)
  if (!existsSync(local)) missing.push(p)
  files[p] = local
}
if (missing.length) {
  process.stderr.write(`MANIFEST.json lists files that are missing: ${missing.join(', ')}\n`)
  process.exit(1)
}
process.stdout.write(JSON.stringify({ workFolder: work, file_path: join(work, 'index.html'), files }, null, 2) + '\n')
