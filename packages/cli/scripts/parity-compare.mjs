#!/usr/bin/env node
// Editor-parity comparison harness (Phase 2 runbook, made repeatable).
// Usage: node scripts/parity-compare.mjs <editor.mp4> <cli.mp4>
// Requires ffmpeg/ffprobe on PATH. Compares stream params, decoded video
// hashes, and the audio null-test residual; exits 1 on video mismatch.
import { execFileSync } from 'node:child_process'

const [a, b] = process.argv.slice(2)
if (!a || !b) {
  console.error('usage: parity-compare.mjs <editor.mp4> <cli.mp4>')
  process.exit(2)
}

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const runStderr = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (err) {
    return err.stderr ?? ''
  }
}

const probe = (f) =>
  run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,sample_rate,channels:format=duration', '-of', 'csv', f])
const videoMd5 = (f) => run('ffmpeg', ['-v', 'error', '-i', f, '-map', '0:v', '-f', 'md5', '-']).trim()

console.log('--- stream params')
const pa = probe(a)
const pb = probe(b)
console.log(pa === pb ? 'IDENTICAL' : `DIFFER:\n${a}: ${pa}\n${b}: ${pb}`)

console.log('--- decoded video')
const va = videoMd5(a)
const vb = videoMd5(b)
console.log(`${va} vs ${vb} → ${va === vb ? 'BIT-IDENTICAL' : 'MISMATCH'}`)

console.log('--- audio null test (inverted mix residual; -91 dB = digital silence)')
const nullOut = runStderr('ffmpeg', ['-i', a, '-i', b, '-filter_complex', '[1:a]volume=-1.0[i];[0:a][i]amix=inputs=2:normalize=0[d];[d]volumedetect', '-f', 'null', '-'])
console.log(nullOut.split('\n').filter((l) => /mean_volume|max_volume/.test(l)).join('\n') || '(no audio streams)')

process.exit(va === vb ? 0 : 1)
