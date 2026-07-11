import { describe, it, expect } from 'vitest'
import { mkdtempSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Browser end-to-end: exports the no-media fixture through headless Chrome and
 * probes the result with mediabunny. Opt-in (needs a Chromium-family browser):
 *   ELAH_E2E=1 npm test --workspace=packages/cli
 */
describe.runIf(process.env.ELAH_E2E === '1')('elah export e2e (ELAH_E2E=1)', () => {
  it('exports the text-only fixture to a valid 2s MP4', async () => {
    const { runExport } = await import('./commands/export')
    const { probeMedia } = await import('./lib/probe')

    const out = join(mkdtempSync(join(tmpdir(), 'elah-e2e-')), 'out.mp4')
    await runExport({
      project: fileURLToPath(new URL('./__fixtures__/text-only.json', import.meta.url)),
      out,
      headed: false,
      verbose: false,
    })

    expect(statSync(out).size).toBeGreaterThan(1000)
    // MP4 ftyp box in the first bytes
    expect(readFileSync(out).subarray(4, 8).toString()).toBe('ftyp')
    const info = await probeMedia(out)
    expect(info.durationSec).toBeCloseTo(2.0, 1)
    expect(info.width).toBe(1280)
    expect(info.height).toBe(720)
  }, 120_000)
})

describe.runIf(process.env.ELAH_E2E === '1')('elah serve e2e (ELAH_E2E=1)', () => {
  it('renders a text-only spec over HTTP to a valid MP4', async () => {
    const { createRenderSession } = await import('./lib/render-session')
    const { startServe } = await import('./lib/serve')

    const fixturesDir = dirname(fileURLToPath(new URL('./__fixtures__/text-only.json', import.meta.url)))
    const session = createRenderSession()
    const handle = await startServe({
      host: '127.0.0.1',
      port: 0,
      concurrency: 1,
      mediaRoot: fixturesDir,
      render: {},
      session,
    })

    try {
      const spec = {
        fps: 30,
        stage: { width: 1280, height: 720 },
        clips: [{ track: 'text', text: 'serve', start: 0, duration: 2 }],
      }
      const res = await fetch(`http://127.0.0.1:${handle.port}/render`, {
        method: 'POST',
        body: JSON.stringify(spec),
      })
      expect(res.status).toBe(200)
      const bytes = Buffer.from(await res.arrayBuffer())
      expect(bytes.subarray(4, 8).toString()).toBe('ftyp')
    } finally {
      await handle.close()
      await session.close()
    }
  }, 120_000)
})
