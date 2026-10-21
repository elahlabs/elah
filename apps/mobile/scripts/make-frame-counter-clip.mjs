#!/usr/bin/env node
// Renders the RN-P6 decode test clip: 10 s at 30 fps, one text clip per frame
// showing that frame's number, exported by @elah/cli through core's real
// exportVideo pipeline (the same encoder the web editor uses).
//
// Scrubbing the decoded clip to frame N must show the number N (the RN-P6
// acceptance test in docs/react-native/04-workstreams.md).
//
// Run from the repo root after `npm install` and `npm run build:packages`:
//   node apps/mobile/scripts/make-frame-counter-clip.mjs
// Needs a system Google Chrome (or ELAH_BROWSER), like every `elah export`.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FPS = 30
const FRAMES = 300

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')
const out = path.join(here, '../assets/frame-counter-30fps-10s.mp4')

const clips = []
for (let frame = 0; frame < FRAMES; frame++) {
  // start = frame / fps rounds back to exactly `frame` in the CLI's seconds -> frames step.
  clips.push({
    track: 'text',
    text: String(frame).padStart(3, '0'),
    start: frame / FPS,
    duration: 1 / FPS,
    fontSize: 360,
    color: '#ffffff',
    fontWeight: 'bold',
    align: 'center',
    x: 0.5,
    y: 0.5,
  })
}

const spec = { fps: FPS, stage: { width: 1280, height: 720 }, assets: {}, clips }
const specPath = path.join(mkdtempSync(path.join(tmpdir(), 'elah-frame-counter-')), 'spec.json')
writeFileSync(specPath, JSON.stringify(spec))

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/elah'),
  ['build', '--spec', specPath, '--export', out, '--height', '720', '--codec', 'avc'],
  { stdio: 'inherit' },
)
console.log(`wrote ${path.relative(repoRoot, out)}`)
