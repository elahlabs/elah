import { describe, it, expect } from 'vitest'
import { mkdtempSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
