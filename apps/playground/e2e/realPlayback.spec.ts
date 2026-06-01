/**
 * realPlayback.spec.ts — real-browser golden-pixel playback validation.
 *
 * Tests:
 *  1. Import the MP4 fixture via AssetPanel file input.
 *  2. Click "+ Video Track" then "+ Video Clip" (the playground's
 *     addVideoClip uses the most recently imported video asset's src,
 *     so the clip is backed by the real fixture decode pipeline).
 *  3. Seek to a specific frame.
 *  4. Wait for the decoder to actually produce frames (via
 *     window.__GPU__.counters()), guaranteeing the hash encodes real
 *     decoded pixels rather than a black cache-miss frame.
 *  5. SHA-256 hash the pixel data via window.__GPU__.readCanvas().
 *  6. Assert the hash is consistent across 3 consecutive runs and
 *     matches GOLDEN_HEX.
 *  7. Repeat after a WEBGL_lose_context / restoreContext cycle.
 *
 * Golden hash:
 *   GOLDEN_HEX encodes the canvas pixels for the calibrated viewport
 *   (1280x800, DPR=1, headless Chromium) at SEEK_FRAME. To recalibrate
 *   after intentional rendering changes or fixture regeneration:
 *     1. Set GOLDEN_HEX to 'UNCALIBRATED'.
 *     2. Run `npm run test:e2e` and read the "Frame hashes" line.
 *     3. Paste the new hash into GOLDEN_HEX.
 *   See: scripts/generateFixture.ts for regenerating the fixture MP4.
 *
 * Note on timing:
 *   Real video decode is async. After seeking we poll the decoder counters
 *   until at least one frame has been produced (cacheMisses + cacheHits > 0
 *   and the cache is non-empty), then poll readCanvas() until the hash
 *   stabilises across multiple reads.
 */

import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = path.join(__dirname, 'fixtures/sample-h264-320x240-1s.mp4')

/** SHA-256 hex of the rendered frame at the calibrated seek position.
 * Encodes the decoded fixture pixels rendered on a 1060x309 canvas
 * (the GpuPreview content area in the 1280x800 / DPR=1 headless viewport).
 * Update after intentional rendering changes or fixture regeneration.
 * Set to 'UNCALIBRATED' to skip the golden assertion (only consistency
 * and "decoded-not-black" are checked). */
const GOLDEN_HEX: string = '66370ee049d967946fd67d13e941a246bfebc88411329d81c892bf7a655e2f74'

const SEEK_FRAME = 15        // ~0.5s in a 30fps clip
const DECODE_WAIT_MS = 8000  // max time to wait for first decoded frame
const MEDIA_DRAG_MIME = 'application/x-elah-media-asset'

/**
 * Sanity threshold: after we believe a frame has been decoded and uploaded,
 * the canvas must have at least this many non-trivially-coloured pixels.
 * Guards against false-positives where a stable hash is just a black canvas
 * (which previously masked a real renderer ownership bug).
 */
const MIN_NON_BLACK_PIXELS = 1_000

/** Snapshot shape returned by window.__GPU__.counters() (mirrors CounterSnapshot). */
interface CountersLike {
  cacheHits: number
  cacheMisses: number
  cacheSize: number
  activeVideoFrames: number
  closedVideoFrames: number
  droppedFrames: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function importFixtureViaFileInput(page: Page): Promise<void> {
  const fileInput = page.locator('[data-testid="asset-file-input"]')
  await fileInput.setInputFiles(FIXTURE_PATH)
  // Wait for the asset panel to show at least one item
  await page.waitForSelector('[title="sample-h264-320x240-1s.mp4"]', { timeout: 10_000 })
}

async function addVideoTrackAndClip(page: Page): Promise<void> {
  // Add a video track
  await page.click('button:has-text("+ Video Track")')

  // Get the asset ID from the app state and use it to create a clip with a real src
  const assetSrc = await page.evaluate((): string => {
    // @ts-expect-error — accessing module-internal stores via global
    const { useMediaLibraryStore } = (window as unknown as { __editorStore?: unknown })

    // Walk the store via the Zustand global dev hook
    const storeState = (
      Object.values(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__ZUSTAND_DEVTOOLS_STORES__ ?? {},
      ) as Array<{ getState?: () => { assets: Record<string, { kind: string; src: string }> } }>
    ).find((s) => s.getState?.()?.assets !== undefined)?.getState?.()

    if (storeState) {
      const videoAsset = Object.values(storeState.assets).find(
        (a: { kind: string; src: string }) => a.kind === 'video',
      )
      if (videoAsset) return videoAsset.src
    }
    return ''
  })

  // Dispatch a programmatic drop-like operation via the Timeline engine
  await page.evaluate((src: string) => {
    // Find the timeline engine and add a clip with the real src
    // This mimics what useTimelineDrop does
    const app = (window as unknown as {
      __TEST_ADD_CLIP?: (src: string, startFrame: number, durationFrames: number) => void
    }).__TEST_ADD_CLIP

    if (app && src) {
      app(src, 0, 90) // 3 seconds at 30fps
    }
  }, assetSrc)
}

async function seekToFrame(page: Page, frame: number): Promise<void> {
  // Use the GpuPreview seek slider
  const slider = page.locator('input[type="range"]').last()
  await slider.fill(String(frame))
  await slider.dispatchEvent('change')
}

async function readCounters(page: Page): Promise<CountersLike | null> {
  return page.evaluate((): CountersLike | null => {
    const gpu = (window as unknown as {
      __GPU__?: { counters(): CountersLike }
    }).__GPU__
    if (!gpu) return null
    try {
      return gpu.counters()
    } catch {
      return null
    }
  })
}

/**
 * Wait until the decoder has actually produced at least one frame and the
 * texture cache is warm. Without this guard, readCanvas() may stabilise on
 * a black cache-miss frame and the test would pass for the wrong reason.
 */
async function waitForDecodeProgress(page: Page, timeoutMs: number): Promise<CountersLike> {
  const deadline = Date.now() + timeoutMs
  let last: CountersLike | null = null
  while (Date.now() < deadline) {
    const c = await readCounters(page)
    if (c) {
      last = c
      const totalLookups = c.cacheHits + c.cacheMisses
      // A real decoded frame is on the canvas once we've had at least one
      // cache miss (initial decode request) AND the cache has a populated entry.
      if (totalLookups > 0 && c.cacheSize > 0) return c
    }
    await page.waitForTimeout(100)
  }
  throw new Error(
    `Decoder produced no frames within ${timeoutMs}ms (last counters: ${JSON.stringify(last)})`,
  )
}

async function waitForDecodedFrame(page: Page, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let lastHash = ''
  let stableCount = 0

  while (Date.now() < deadline) {
    const hash = await page.evaluate(async (): Promise<string> => {
      const gpu = (window as unknown as { __GPU__?: { readCanvas(): Promise<string> } }).__GPU__
      if (!gpu) return ''
      try {
        return await gpu.readCanvas()
      } catch {
        return ''
      }
    })

    if (hash === lastHash && hash !== '') {
      stableCount++
      if (stableCount >= 3) return hash
    } else {
      stableCount = hash !== '' ? 1 : 0
      lastHash = hash
    }

    await page.waitForTimeout(100)
  }

  return lastHash
}

async function loseAndRestoreContext(page: Page): Promise<void> {
  await page.evaluate((): void => {
    const canvas = document.querySelector('canvas')
    if (!canvas) return
    const ext = canvas
      .getContext('webgl2')
      ?.getExtension('WEBGL_lose_context')
    if (ext) {
      ext.loseContext()
      // Restore after a short delay
      setTimeout(() => ext.restoreContext(), 500)
    }
  })
  // Wait for restore + re-render
  await page.waitForTimeout(1500)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Real video playback golden pixel test', () => {
  test.beforeEach(async ({ page }) => {
    // Surface real browser errors so renderer regressions don't pass silently
    // (e.g. "WebGL: INVALID_OPERATION: texImage2D: can't texture a closed
    // VideoFrame" — a previous bug where the cache's borrowed reference was
    // closed by VideoTexture.upload). Vite/React dev noise is filtered out.
    page.on('console', (msg) => {
      const type = msg.type()
      if (type !== 'warning' && type !== 'error') return
      const text = msg.text()
      if (text.startsWith('[vite]')) return
      if (text.startsWith('[.WebGL') && text.includes('GPU stall due to ReadPixels')) return
      // eslint-disable-next-line no-console
      console.log(`[browser:${type}]`, text)
    })
    page.on('pageerror', (err) => {
      // eslint-disable-next-line no-console
      console.log('[browser:pageerror]', err.message)
    })

    await page.goto('http://localhost:5173')
    await page.waitForSelector('button:has-text("+ Video Track")', { timeout: 15_000 })
  })

  test('import MP4 fixture and render pixels — consistent across 3 runs', async ({ page }) => {
    await importFixtureViaFileInput(page)

    // Add a video track, then a clip backed by the most-recently imported
    // video asset (the playground's addVideoClip handler wires asset.src
    // and asset.id automatically, so this exercises the real decode path).
    await page.click('button:has-text("+ Video Track")')
    await page.click('button:has-text("+ Video Clip")')

    const slider = page.locator('input[type="range"]').last()
    await slider.fill(String(SEEK_FRAME))
    await slider.dispatchEvent('change')

    // Wait for the decoder to produce at least one real frame before
    // hashing. This prevents false-positive "consistency" on a black canvas.
    const counters = await waitForDecodeProgress(page, DECODE_WAIT_MS)
    // eslint-disable-next-line no-console
    console.log('Decoder counters after first decode:', counters)

    const canvasSize = await page.evaluate((): { width: number; height: number } | null => {
      const gpu = (window as unknown as {
        __GPU__?: { canvasSize(): { width: number; height: number } }
      }).__GPU__
      return gpu ? gpu.canvasSize() : null
    })
    // eslint-disable-next-line no-console
    console.log('Canvas drawing buffer:', canvasSize)

    // Give the decoder + RAF a moment to upload the first frame, then verify
    // the canvas actually contains decoded pixels — not a black cache-miss
    // frame. This guards against the previous bug where VideoTexture.upload
    // closed the cache's borrowed VideoFrame and every subsequent texImage2D
    // failed with INVALID_OPERATION, leaving the canvas black while the
    // counters all looked healthy.
    await page.waitForTimeout(500)
    const stats = await page.evaluate((): {
      total: number; nonBlack: number; maxRgb: number
    } | null => {
      const gpu = (window as unknown as {
        __GPU__?: {
          canvasSize(): { width: number; height: number }
          readPixelRegion(x: number, y: number, w: number, h: number): Uint8Array
        }
      }).__GPU__
      if (!gpu) return null
      const { width, height } = gpu.canvasSize()
      const px = gpu.readPixelRegion(0, 0, width, height)
      let nonBlack = 0
      let maxRgb = 0
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i], g = px[i + 1], b = px[i + 2]
        if (r > 4 || g > 4 || b > 4) nonBlack++
        if (r > maxRgb) maxRgb = r
        if (g > maxRgb) maxRgb = g
        if (b > maxRgb) maxRgb = b
      }
      return { total: px.length / 4, nonBlack, maxRgb }
    })
    // eslint-disable-next-line no-console
    console.log('Canvas pixel stats:', stats)
    expect(stats, 'pixel stats probe returned null').not.toBeNull()
    expect(
      stats!.nonBlack,
      `canvas appears entirely black (max channel = ${stats!.maxRgb}); the decoder ran but no decoded frame reached the framebuffer`,
    ).toBeGreaterThan(MIN_NON_BLACK_PIXELS)

    const hashes: string[] = []
    for (let run = 0; run < 3; run++) {
      if (run > 0) {
        await slider.fill(String(SEEK_FRAME - 1))
        await slider.dispatchEvent('change')
        await page.waitForTimeout(50)
        await slider.fill(String(SEEK_FRAME))
        await slider.dispatchEvent('change')
        await waitForDecodeProgress(page, DECODE_WAIT_MS)
      }

      const hash = await waitForDecodedFrame(page, DECODE_WAIT_MS)
      hashes.push(hash)
    }

    // eslint-disable-next-line no-console
    console.log('Frame hashes (3 runs):', hashes)

    expect(hashes[0]).toBeTruthy()
    expect(hashes[1]).toBe(hashes[0])
    expect(hashes[2]).toBe(hashes[0])

    if (GOLDEN_HEX !== 'UNCALIBRATED') {
      expect(hashes[0]).toBe(GOLDEN_HEX)
    }
  })

  test('hash is stable after WebGL context loss + restore', async ({ page }) => {
    await importFixtureViaFileInput(page)
    await page.click('button:has-text("+ Video Track")')
    await page.click('button:has-text("+ Video Clip")')

    const slider = page.locator('input[type="range"]').last()
    await slider.fill(String(SEEK_FRAME))
    await slider.dispatchEvent('change')

    const hashBefore = await waitForDecodedFrame(page, DECODE_WAIT_MS)
    expect(hashBefore).toBeTruthy()

    // Simulate WebGL context loss/restore
    await loseAndRestoreContext(page)

    const hashAfter = await waitForDecodedFrame(page, DECODE_WAIT_MS)
    expect(hashAfter).toBeTruthy()

    // After context restore, rendering should produce the same output
    expect(hashAfter).toBe(hashBefore)
  })

  test('canvas produces non-empty output with a clip on the timeline', async ({ page }) => {
    await page.click('button:has-text("+ Video Track")')
    await page.click('button:has-text("+ Video Clip")')

    await page.waitForTimeout(500)

    const hash = await page.evaluate(async (): Promise<string> => {
      const gpu = (window as unknown as { __GPU__?: { readCanvas(): Promise<string> } }).__GPU__
      if (!gpu) return ''
      return gpu.readCanvas()
    })

    // Canvas must produce a non-empty SHA-256 hash (all-zero = nothing rendered)
    expect(hash).toBeTruthy()
    expect(hash).toHaveLength(64)
  })

  test('continuous playback advances through multiple frames — canvas hash changes', async ({ page }) => {
    await importFixtureViaFileInput(page)
    await page.click('button:has-text("+ Video Track")')
    await page.click('button:has-text("+ Video Clip")')

    // Seek to frame 0 and wait for first decode
    const slider = page.locator('input[type="range"]').last()
    await slider.fill('0')
    await slider.dispatchEvent('change')
    await waitForDecodeProgress(page, DECODE_WAIT_MS)

    // Sample canvas hash at frame 0
    const hashAt0 = await waitForDecodedFrame(page, DECODE_WAIT_MS)
    expect(hashAt0).toBeTruthy()
    expect(hashAt0).toHaveLength(64)

    // Press Play and let the RAF loop advance through ~30 frames
    await page.click('button:has-text("Play")')
    await page.waitForTimeout(1500) // ~45 frames at 30fps

    // Pause so the canvas stabilises on a non-zero frame
    await page.click('button:has-text("Pause")')
    await page.waitForTimeout(200)

    // Verify decoder did not get stuck in Errored state
    const decoderStates = await page.evaluate((): Record<string, string> => {
      const gpu = (window as unknown as {
        __GPU__?: { counters(): CountersLike & { decoderStates?: Record<string, string> } }
      }).__GPU__
      return gpu?.counters() as unknown as Record<string, string> ?? {}
    })
    // eslint-disable-next-line no-console
    console.log('Decoder states after playback:', decoderStates)

    // Check that frames advanced: counters should show cache hits from multiple frames
    const countersAfterPlay = await readCounters(page)
    // eslint-disable-next-line no-console
    console.log('Counters after playback:', countersAfterPlay)
    expect(countersAfterPlay).not.toBeNull()
    expect(countersAfterPlay!.cacheHits).toBeGreaterThan(0)

    // Sample canvas hash after playback — must differ from frame 0 unless the
    // clip only has one unique frame (unlikely for a 1s fixture).
    const hashAfterPlay = await waitForDecodedFrame(page, DECODE_WAIT_MS)
    expect(hashAfterPlay).toBeTruthy()
    expect(hashAfterPlay).toHaveLength(64)
    expect(
      hashAfterPlay,
      'canvas hash did not change after 1.5s of playback — frames appear stuck',
    ).not.toBe(hashAt0)
  })

  test('seeking through multiple frames produces different canvas output per frame', async ({ page }) => {
    await importFixtureViaFileInput(page)
    await page.click('button:has-text("+ Video Track")')
    await page.click('button:has-text("+ Video Clip")')

    const slider = page.locator('input[type="range"]').last()
    const sampledHashes: string[] = []

    // Seek to 3 spread-out frames and collect hashes
    for (const frame of [0, 10, 20]) {
      await slider.fill(String(frame))
      await slider.dispatchEvent('change')
      await waitForDecodeProgress(page, DECODE_WAIT_MS)
      const hash = await waitForDecodedFrame(page, DECODE_WAIT_MS)
      sampledHashes.push(hash)
      // eslint-disable-next-line no-console
      console.log(`Hash at frame ${frame}:`, hash)
    }

    // All hashes must be non-empty
    for (const h of sampledHashes) {
      expect(h).toBeTruthy()
      expect(h).toHaveLength(64)
    }

    // At least two of the three hashes must differ
    // (frames 0, 10, 20 of a real video are virtually guaranteed to differ)
    const unique = new Set(sampledHashes)
    expect(
      unique.size,
      `all three seek frames produced the same canvas hash ${sampledHashes[0]} — decoder is likely stuck`,
    ).toBeGreaterThan(1)
  })

  test('backward seek: canvas pixels change after seek from N to N-50', async ({ page }) => {
    await importFixtureViaFileInput(page)
    await page.click('button:has-text("+ Video Track")')
    await page.click('button:has-text("+ Video Clip")')

    const slider = page.locator('input[type="range"]').last()
    const forwardFrame = 60
    const backwardFrame = forwardFrame - 50

    await slider.fill(String(forwardFrame))
    await slider.dispatchEvent('change')
    await waitForDecodeProgress(page, DECODE_WAIT_MS)

    const hashForward = await waitForDecodedFrame(page, DECODE_WAIT_MS)
    expect(hashForward).toBeTruthy()
    expect(hashForward).toHaveLength(64)

    await slider.fill(String(backwardFrame))
    await slider.dispatchEvent('change')
    await waitForDecodeProgress(page, DECODE_WAIT_MS)

    const hashBackward = await waitForDecodedFrame(page, DECODE_WAIT_MS)
    expect(hashBackward).toBeTruthy()
    expect(hashBackward).toHaveLength(64)

    expect(
      hashBackward,
      `canvas hash unchanged after backward seek ${forwardFrame} → ${backwardFrame} — stuck-frame regression`,
    ).not.toBe(hashForward)
  })
})
