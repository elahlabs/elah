import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FfmpegBinary } from '../locate'
import {
  browserDecodeCheckJs,
  buildTranscodeArgs,
  pickIntermediate,
  planConversion,
  portable,
  probeSource,
  type Intermediate,
  type SourceProbe,
} from '../transcode'
import { createSourcePreparer, type EvaluatingPage } from '../prepare'
import { parseFfmpegInfo } from '../../probe'

function fakeFfmpeg(encoders: string[], version: [number, number] | null = [6, 1]): FfmpegBinary {
  return { path: 'ffmpeg', versionLine: 'ffmpeg version x', version, encoders: new Set(encoders) }
}

const everything = fakeFfmpeg(['libx264', 'aac', 'libvpx-vp9', 'libopus'])
const mp4 = pickIntermediate({ mp4: true, webm: true }, everything) as Intermediate

const h264aac: SourceProbe = {
  container: 'MP4',
  video: { codec: 'avc', config: { codec: 'avc1.64001e' }, firstTimestamp: 0 },
  audio: { codec: 'aac', config: { codec: 'mp4a.40.2' } },
}

describe('pickIntermediate', () => {
  it('prefers H.264/AAC MP4 when the browser decodes it', () => {
    expect(mp4.container).toBe('mp4')
    expect(mp4.videoEncoder).toBe('libx264')
  })

  it('falls back to VP9/Opus WebM for a browser without H.264 (Chromium)', () => {
    const webm = pickIntermediate({ mp4: false, webm: true }, everything) as Intermediate
    expect(webm.container).toBe('webm')
    expect([webm.videoEncoder, webm.audioEncoder]).toEqual(['libvpx-vp9', 'libopus'])
  })

  it('falls back to WebM when ffmpeg lacks libx264, and explains when nothing fits', () => {
    expect((pickIntermediate({ mp4: true, webm: true }, fakeFfmpeg(['aac', 'libvpx-vp9', 'libopus'])) as Intermediate).container).toBe('webm')
    expect(pickIntermediate({ mp4: false, webm: true }, fakeFfmpeg(['libx264', 'aac']))).toMatch(/no intermediate/)
  })
})

describe('planConversion', () => {
  it('leaves a source the browser decodes alone', () => {
    expect(planConversion(h264aac, { video: true, audio: true }, mp4)).toBeNull()
    const silent: SourceProbe = { container: 'WebM', video: { codec: 'vp9', config: { codec: 'vp09.00.10.08' } } }
    expect(planConversion(silent, { video: true }, mp4)).toBeNull()
  })

  it('re-encodes an unreadable container (AVI) entirely', () => {
    expect(planConversion({ container: null }, {}, mp4)).toEqual({
      reason: 'its container cannot be read in the browser',
      copyVideo: false,
      copyAudio: false,
    })
  })

  it('re-encodes undecodable video (HEVC without a decoder, ProRes) and copies audio that fits', () => {
    const hevc = { ...h264aac, video: { codec: 'hevc', config: { codec: 'hev1.1.6.L93.90' }, firstTimestamp: 0 } }
    expect(planConversion(hevc, { video: false, audio: true }, mp4)).toEqual({
      reason: 'Chrome cannot decode hevc video',
      copyVideo: false,
      copyAudio: true,
      videoStart: 0,
    })
    const prores: SourceProbe = {
      container: 'QuickTime File Format',
      video: { codec: 'prores', config: { codec: 'apcn' }, firstTimestamp: 0 },
      audio: { codec: 'pcm-s16', config: { codec: 'pcm-s16' } },
    }
    // PCM decodes but cannot be copied into MP4: re-encoded to AAC.
    expect(planConversion(prores, { video: false, audio: true }, mp4)).toMatchObject({ copyVideo: false, copyAudio: false })
  })

  it('converts only the audio when the video decodes (AC-3 in MKV)', () => {
    const ac3: SourceProbe = { ...h264aac, container: 'Matroska', audio: { codec: 'ac3', config: { codec: 'ac-3' } } }
    expect(planConversion(ac3, { video: true, audio: false }, mp4)).toMatchObject({
      reason: 'Chrome cannot decode ac3 audio',
      copyVideo: true,
      copyAudio: false,
    })
  })

  it('remuxes decodable audio in a container decodeAudioData cannot read (MPEG-TS), keeping its start', () => {
    const ts: SourceProbe = {
      ...h264aac,
      container: 'MPEG Transport Stream',
      video: { ...h264aac.video!, firstTimestamp: 1.4667 },
    }
    expect(planConversion(ts, { video: true, audio: true }, mp4)).toEqual({
      reason: 'Chrome cannot decode audio in MPEG Transport Stream',
      copyVideo: true,
      copyAudio: true,
      videoStart: 1.4667,
    })
  })

  it('treats an unknown codec or a missing decoder config as undecodable', () => {
    const unknown: SourceProbe = { container: 'Matroska', audio: { codec: null, config: null } }
    expect(planConversion(unknown, { audio: false }, mp4)?.reason).toBe('Chrome cannot decode unknown audio')
  })
})

describe('buildTranscodeArgs', () => {
  const full = { reason: 'x', copyVideo: false, copyAudio: false }

  it('re-encodes to the intermediate with frame timing passed through', () => {
    const args = buildTranscodeArgs(everything, 'in.mov', 'out.mp4', full, mp4).join(' ')
    expect(args).toContain('-i in.mov -map 0:v:0? -map 0:a:0? -sn -dn')
    expect(args).toContain('-c:v libx264 -preset veryfast -crf 14 -pix_fmt yuv420p -fps_mode passthrough')
    expect(args).toContain('-c:a aac -b:a 256000 -movflags +faststart -f mp4 out.mp4')
    expect(args).not.toContain('-copyts')
  })

  it('stream-copies what fits and uses -vsync before ffmpeg 5.1', () => {
    const args = buildTranscodeArgs(fakeFfmpeg(['libx264', 'aac'], [4, 4]), 'in.ts', 'out.mp4', { ...full, copyVideo: true, copyAudio: true }, mp4)
    expect(args.join(' ')).toContain('-c:v copy -vsync passthrough -c:a copy')
  })

  it('shifts every stream so the first video frame is at 0', () => {
    const args = buildTranscodeArgs(everything, 'in.ts', 'out.mp4', { ...full, videoStart: 1.4667 }, mp4)
    expect(args.slice(0, 8)).toContain('-copyts')
    expect(args.indexOf('-copyts')).toBeLessThan(args.indexOf('-i'))
    expect(args.join(' ')).toContain('-output_ts_offset -1.4667 -avoid_negative_ts disabled')
  })

  it('writes WebM without MP4 flags', () => {
    const webm = pickIntermediate({ mp4: false, webm: true }, everything) as Intermediate
    const args = buildTranscodeArgs(everything, 'in.mov', 'out.webm', full, webm)
    expect(args).not.toContain('-movflags')
    expect(args.slice(-3)).toEqual(['-f', 'webm', 'out.webm'])
  })
})

describe('portable / browserDecodeCheckJs', () => {
  it('carries the codec description across as base64', () => {
    const config = portable({ codec: 'avc1.64001e', codedWidth: 640, codedHeight: 360, description: new Uint8Array([1, 100, 0, 30]) })
    expect(config).toEqual({ codec: 'avc1.64001e', codedWidth: 640, codedHeight: 360, description: 'AWQAHg==' })
    expect(portable(null)).toBeNull()
  })

  it('produces one self-contained expression with the checks inlined as JSON', () => {
    const js = browserDecodeCheckJs([{ kind: 'video', config: { codec: 'apcn' } }])
    expect(js.startsWith('(async (checks) =>')).toBe(true)
    expect(js).toContain('[{"kind":"video","config":{"codec":"apcn"}}]')
    expect(() => new Function(`return ${js}`)).not.toThrow()
  })
})

describe('parseFfmpegInfo', () => {
  it('reads duration and the first video size from `ffmpeg -i` stderr', () => {
    const stderr = `Input #0, avi, from 'clip.avi':
  Duration: 00:01:03.50, start: 0.000000, bitrate: 2915 kb/s
  Stream #0:0: Video: mpeg4 (Simple Profile) (FMP4 / 0x34504D46), yuv420p, 640x360 [SAR 1:1 DAR 16:9], 2780 kb/s, 30 fps
  Stream #0:1: Audio: mp3 (U[0][0][0] / 0x0055), 48000 Hz, mono, fltp, 128 kb/s
At least one output file must be specified`
    expect(parseFfmpegInfo(stderr)).toEqual({ durationSec: 63.5, width: 640, height: 360 })
  })

  it('returns null without a usable duration (a still image reports N/A)', () => {
    expect(parseFfmpegInfo('  Duration: N/A, start: 0.000000, bitrate: N/A')).toBeNull()
    expect(parseFfmpegInfo('garbage')).toBeNull()
  })

  it('reads audio-only files without a size', () => {
    expect(parseFfmpegInfo('  Duration: 00:00:03.01, start: 0.0\n  Stream #0:0: Audio: wmav2, 44100 Hz')).toEqual({ durationSec: 3.01 })
  })
})

/**
 * Real ffmpeg + mediabunny, fake browser: opt in with ELAH_FFMPEG, e.g.
 *   ELAH_FFMPEG=/usr/bin/ffmpeg npm test --workspace=packages/cli
 */
const ffmpegPath = process.env.ELAH_FFMPEG

describe.runIf(!!ffmpegPath)('source preparation with real ffmpeg (ELAH_FFMPEG set)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'elah-prepare-'))
  const make = (name: string, args: string[]) => {
    execFileSync(ffmpegPath!, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '2', ...args, join(dir, name),
    ])
    return join(dir, name)
  }

  /** A browser that answers decode checks with `supported(codec)`; counts its evaluate calls. */
  function fakePage(supported: (codec: string) => boolean): EvaluatingPage & { calls: number } {
    const page = {
      calls: 0,
      async evaluate<T>(expression: string): Promise<T> {
        page.calls++
        const checks = JSON.parse(expression.slice(expression.lastIndexOf('})))(') + 5, -1)) as Array<{ config: { codec: string } }>
        return checks.map((c) => supported(c.config.codec)) as T
      },
    }
    return page
  }
  // As measured in branded Chrome: H.264, AAC, VP9, Opus and PCM decode; ProRes and AC-3 do not.
  const chromeLike = (codec: string) => /^(avc1|mp4a|vp09|opus|pcm-)/.test(codec)

  it('probes a TS start, a ProRes MOV and an unreadable AVI', async () => {
    const ts = await probeSource(make('a.ts', ['-c:v', 'libx264', '-c:a', 'aac']))
    expect(ts.container).toBe('MPEG Transport Stream')
    expect(ts.video?.firstTimestamp).toBeGreaterThan(1)
    expect((await probeSource(make('a.mov', ['-c:v', 'prores_ks', '-c:a', 'pcm_s16le']))).video?.codec).toBe('prores')
    expect((await probeSource(make('a.avi', ['-c:v', 'mpeg4', '-c:a', 'libmp3lame']))).container).toBeNull()
  }, 60_000)

  it('converts only what the browser cannot decode, once per source, and rebases TS to 0', async () => {
    const { locateFfmpeg } = await import('../locate')
    const preparer = createSourcePreparer(() => locateFfmpeg())
    const ok = make('ok.mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'])
    const prores = make('p.mov', ['-c:v', 'prores_ks', '-c:a', 'pcm_s16le'])
    const ts = make('t.ts', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'])
    const media = new Map([['/r/0', ok], ['/r/1', prores], ['/r/2', ts]])
    const status: string[] = []
    try {
      await preparer.prepare(fakePage(chromeLike), media, new Set(media.keys()), { onStatus: (m) => status.push(m) })
      expect(media.get('/r/0')).toBe(ok)
      expect(media.get('/r/1')).toMatch(/source-\d\.mp4$/)
      expect(media.get('/r/2')).toMatch(/source-\d\.mp4$/)
      expect(status.filter((m) => m.includes('converted in'))).toHaveLength(2)

      const rebased = await probeSource(media.get('/r/2')!)
      expect(rebased.video?.firstTimestamp).toBe(0)
      expect((await probeSource(media.get('/r/1')!)).video?.codec).toBe('avc')

      // A second render reuses the conversions instead of running ffmpeg again.
      const again = new Map([['/q/0', prores]])
      const page = fakePage(chromeLike)
      await preparer.prepare(page, again, new Set(again.keys()), { onStatus: (m) => status.push(m) })
      expect(again.get('/q/0')).toBe(media.get('/r/1'))
      expect(page.calls).toBe(0)
    } finally {
      await preparer.dispose()
    }
  }, 120_000)

  it('warns and serves the original when ffmpeg is unavailable', async () => {
    const preparer = createSourcePreparer(async () => new Error('No ffmpeg found.'))
    const prores = make('p2.mov', ['-c:v', 'prores_ks', '-c:a', 'pcm_s16le'])
    const media = new Map([['/r/0', prores]])
    const warnings: string[] = []
    await preparer.prepare(fakePage(chromeLike), media, new Set(media.keys()), { onWarning: (m) => warnings.push(m) })
    expect(media.get('/r/0')).toBe(prores)
    expect(warnings).toEqual([expect.stringMatching(/cannot decode prores video, and ffmpeg is not available.*No ffmpeg found/)])
    await preparer.dispose()
  }, 60_000)

  it('writes the WebM intermediate for a browser without H.264', async () => {
    const { locateFfmpeg } = await import('../locate')
    const preparer = createSourcePreparer(() => locateFfmpeg())
    const hevc = make('h.mp4', ['-c:v', 'libx265', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-c:a', 'aac'])
    const media = new Map([['/r/0', hevc]])
    try {
      await preparer.prepare(fakePage((c) => /^(vp09|opus)/.test(c)), media, new Set(media.keys()))
      const converted = await probeSource(media.get('/r/0')!)
      expect(converted.container).toBe('WebM')
      expect([converted.video?.codec, converted.audio?.codec]).toEqual(['vp9', 'opus'])
    } finally {
      await preparer.dispose()
    }
  }, 120_000)
})
