// Stage the Elah artifact page for publishing. Plain Node, no install.
//
//   node stage.mjs <work-folder>
//
// Copies the plugin's assets/artifact/** into <work-folder> (the Artifact tool only reads files under the
// working directory or the scratchpad, and the plugin lives elsewhere) and prints one JSON object:
//   { "workFolder": "...", "file_path": "<work-folder>/index.html",
//     "files": { "<published path>": "<local path>", ... } }
// `files` lists every path in MANIFEST.json except index.html, plus every file under <work-folder>/assets/ as
// "assets/<name>" (the images the person supplied, referenced from the programmatic video as assets/<name>).
// Add "elah-input.json" yourself.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
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
// Supplied images: <work>/assets/** is published beside the page, so assets/<name> resolves the same on claude.ai.
const supplied = join(work, 'assets')
if (existsSync(supplied) && statSync(supplied).isDirectory()) {
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const local = join(dir, entry.name)
      if (entry.isDirectory()) walk(local)
      else if (entry.isFile()) files[`assets/${relative(supplied, local).split(sep).join('/')}`] = local
    }
  }
  walk(supplied)
}
if (missing.length) {
  process.stderr.write(`MANIFEST.json lists files that are missing: ${missing.join(', ')}\n`)
  process.exit(1)
}
process.stdout.write(JSON.stringify({ workFolder: work, file_path: join(work, 'index.html'), files }, null, 2) + '\n')
