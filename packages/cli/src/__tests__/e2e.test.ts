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
    const { runExport } = await import('../commands/export')
    const { probeMedia } = await import('../lib/probe')

    const out = join(mkdtempSync(join(tmpdir(), 'elah-e2e-')), 'out.mp4')
    await runExport({
      project: fileURLToPath(new URL('../__fixtures__/text-only.json', import.meta.url)),
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
    const { createRenderSession } = await import('../lib/render-session')
    const { startServe } = await import('../lib/serve')

    const fixturesDir = dirname(fileURLToPath(new URL('../__fixtures__/text-only.json', import.meta.url)))
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

/**
 * The ffmpeg encoder end to end: real Chrome composites, real ffmpeg encodes.
 * Opt-in, and needs an ffmpeg (it also generates the test media):
 *   ELAH_E2E=1 ELAH_FFMPEG=/usr/bin/ffmpeg npm test --workspace=packages/cli
 */
describe.runIf(process.env.ELAH_E2E === '1' && !!process.env.ELAH_FFMPEG)(
  'elah export e2e with ffmpeg (ELAH_E2E=1, ELAH_FFMPEG set)',
  () => {
    async function audioTrackOf(file: string) {
      const mb = await import('mediabunny')
      const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.FilePathSource(file) })
      try {
        const audio = await input.getPrimaryAudioTrack()
        return audio ? { codec: audio.codec, sampleRate: audio.sampleRate } : null
      } finally {
        input.dispose?.()
      }
    }

    it('renders video, text and audio through ffmpeg, and Chrome still works as the fallback', async () => {
      const { execFileSync } = await import('node:child_process')
      const { writeFileSync } = await import('node:fs')
      const { buildProject } = await import('../lib/build-project')
      const { exportProject } = await import('../lib/export-project')
      const { probeMedia } = await import('../lib/probe')

      const dir = mkdtempSync(join(tmpdir(), 'elah-e2e-ffmpeg-'))
      const ffmpeg = process.env.ELAH_FFMPEG!
      const run = (args: string[]) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args])
      run([
        '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=330',
        '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(dir, 'footage.mp4'),
      ])
      run(['-f', 'lavfi', '-i', 'sine=frequency=550', '-t', '3', join(dir, 'music.mp3')])
      writeFileSync(
        join(dir, 'spec.json'),
        JSON.stringify({
          fps: 30,
          stage: { width: 1280, height: 720 },
          assets: { footage: './footage.mp4', music: './music.mp3' },
          clips: [
            { track: 'video', asset: 'footage', start: 0, duration: 3, sourceStart: 0.5 },
            { track: 'text', text: 'ffmpeg', start: 0.5, duration: 2, fontSize: 96, x: 0.5, y: 0.2 },
            { track: 'audio', asset: 'music', start: 0, duration: 3, volume: 0.5 },
          ],
        })
      )
      const { project } = await buildProject({ spec: JSON.parse(readFileSync(join(dir, 'spec.json'), 'utf8')), baseDir: dir })

      const encoders: string[] = []
      const warnings: string[] = []
      const callbacks = {
        onEncoder: (d: string) => encoders.push(d),
        onWarning: (m: string) => warnings.push(m),
      }
      const viaFfmpeg = await exportProject(
        { project, projectDir: dir, outPath: join(dir, 'ffmpeg.mp4'), encoder: 'ffmpeg' },
        callbacks
      )
      const viaChrome = await exportProject(
        { project, projectDir: dir, outPath: join(dir, 'chrome.mp4'), encoder: 'chrome' },
        callbacks
      )
      expect(encoders).toEqual(['ffmpeg (libx264)', 'chrome'])
      expect(warnings).toEqual([])

      for (const out of [viaFfmpeg.outPath!, viaChrome.outPath!]) {
        const info = await probeMedia(out)
        expect(info.durationSec).toBeCloseTo(3.0, 1)
        expect(info.width).toBe(1280)
        expect(info.height).toBe(720)
      }
      // Both carry core's own audio mix, at the rate core rendered it.
      const ffmpegAudio = await audioTrackOf(viaFfmpeg.outPath!)
      const chromeAudio = await audioTrackOf(viaChrome.outPath!)
      expect(ffmpegAudio?.codec).toBe('aac')
      expect(ffmpegAudio?.sampleRate).toBe(chromeAudio?.sampleRate)
    }, 240_000)

    it('writes VP9 WebM from a .webm output name through both encoders', async () => {
      const mb = await import('mediabunny')
      const { exportProject } = await import('../lib/export-project')
      const { readProject } = await import('../lib/project-io')
      const { project, dir } = readProject(fileURLToPath(new URL('../__fixtures__/text-only.json', import.meta.url)))
      const outDir = mkdtempSync(join(tmpdir(), 'elah-e2e-webm-'))

      for (const encoder of ['ffmpeg', 'chrome'] as const) {
        const out = join(outDir, `${encoder}.webm`)
        await exportProject({ project, projectDir: dir, outPath: out, encoder })
        const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.FilePathSource(out) })
        try {
          expect((await input.getFormat()).name, encoder).toMatch(/webm/i)
          expect((await input.getPrimaryVideoTrack())?.codec, encoder).toBe('vp9')
          expect(await input.computeDuration(), encoder).toBeCloseTo(2.0, 1)
        } finally {
          input.dispose?.()
        }
      }
    }, 240_000)

    it('auto falls back to Chrome with one warning when ffmpeg is missing', async () => {
      const { exportProject } = await import('../lib/export-project')
      const { readProject } = await import('../lib/project-io')
      const out = join(mkdtempSync(join(tmpdir(), 'elah-e2e-')), 'fallback.mp4')
      const encoders: string[] = []
      const warnings: string[] = []
      const { project, dir } = readProject(fileURLToPath(new URL('../__fixtures__/text-only.json', import.meta.url)))
      await exportProject(
        { project, projectDir: dir, outPath: out, ffmpegPath: join(dir, 'no-such-ffmpeg') },
        { onEncoder: (d) => encoders.push(d), onWarning: (m) => warnings.push(m) }
      )
      expect(encoders).toEqual(['chrome'])
      expect(warnings).toEqual([expect.stringMatching(/^encoding with Chrome instead of ffmpeg: No ffmpeg found/)])
      expect(statSync(out).size).toBeGreaterThan(1000)
    }, 120_000)
  }
)
