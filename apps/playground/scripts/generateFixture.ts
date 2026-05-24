#!/usr/bin/env tsx
/**
 * generateFixture.ts — generate the Playwright E2E test fixture MP4.
 *
 * Writes: e2e/fixtures/sample-h264-320x240-1s.mp4
 *
 * This script produces a 1-second, 320×240, 30fps H.264 MP4 with a
 * deterministic solid-gradient pattern. The output is committed to the repo
 * so CI does not re-run this script. Only run it to regenerate after
 * intentional changes (update golden hashes in realPlayback.spec.ts too).
 *
 * Strategies (tried in order):
 *   1. ffmpeg — fastest; most deterministic across platforms.
 *   2. yt-dlp / curl fallback — downloads a known public-domain test vector.
 *
 * Usage:
 *   npm run fixture:gen           from apps/playground
 *   npx tsx scripts/generateFixture.ts
 *
 * After regenerating, re-run the Playwright test once with PW_HEADED=1 to
 * capture the new golden hash and update GOLDEN_HEX in realPlayback.spec.ts.
 */

import { execSync, spawnSync } from 'child_process'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const FIXTURE_PATH = join(__dirname, '../e2e/fixtures/sample-h264-320x240-1s.mp4')
const FIXTURE_URL = 'https://www.w3schools.com/html/movie.mp4'

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[fixture:gen] ${msg}`)
}

function tryFfmpeg(): boolean {
  const result = spawnSync('ffmpeg', ['-version'], { stdio: 'pipe' })
  if (result.error || result.status !== 0) return false

  log('ffmpeg found — generating deterministic gradient pattern MP4')
  execSync(
    [
      'ffmpeg', '-y',
      '-f', 'lavfi',
      '-i', 'color=c=0x3a7bd5:size=320x240:rate=30',
      '-t', '1',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      `"${FIXTURE_PATH}"`,
    ].join(' '),
    { stdio: 'inherit' },
  )
  return true
}

async function tryFetch(): Promise<boolean> {
  log(`ffmpeg not found — downloading test vector from ${FIXTURE_URL}`)
  try {
    // Use Node.js native fetch (v18+) or the global fetch
    const res = await (global.fetch ?? (await import('node-fetch' as string)).default)(FIXTURE_URL) as Response
    if (!res.ok) {
      log(`Download failed: HTTP ${res.status}`)
      return false
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    writeFileSync(FIXTURE_PATH, buffer)
    log(`Downloaded ${buffer.length} bytes → ${FIXTURE_PATH}`)
    return true
  } catch (err) {
    log(`Download error: ${(err as Error).message}`)
    return false
  }
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main(): Promise<void> {
  if (existsSync(FIXTURE_PATH)) {
    log(`Fixture already exists at ${FIXTURE_PATH} — skipping generation.`)
    log('Delete it first if you want to regenerate.')
    process.exit(0)
  }

  log(`Output: ${FIXTURE_PATH}`)

  const ffmpegOk = tryFfmpeg()
  if (!ffmpegOk) {
    const fetchOk = await tryFetch()
    if (!fetchOk) {
      log('')
      log('ERROR: Could not generate fixture.')
      log('  Option 1: Install ffmpeg and re-run this script.')
      log('  Option 2: Manually place any 320×240 H.264 MP4 at:')
      log(`             ${FIXTURE_PATH}`)
      log('  Option 3: Download from: ' + FIXTURE_URL)
      process.exit(1)
    }
  }

  if (!existsSync(FIXTURE_PATH)) {
    log('ERROR: Expected output file was not created.')
    process.exit(1)
  }

  log('Done. Remember to:')
  log('  1. Run the Playwright test once to capture the golden hash.')
  log('  2. Update GOLDEN_HEX in e2e/realPlayback.spec.ts.')
  log('  3. Commit both the fixture MP4 and the updated spec.')
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})

// Prevent unused import warnings from TypeScript
void createRequire
