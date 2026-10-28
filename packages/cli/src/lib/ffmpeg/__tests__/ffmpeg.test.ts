import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CliError } from '../../errors'
import { locateFfmpeg, parseEncoders, parseFfmpegVersion, type FfmpegBinary } from '../locate'
import { buildPngEncoderArgs, interleaveF32, PngFrameEncoder, type PngEncoderInit } from '../encoder'
import { pickEncoder } from '../select'
import type { VideoCodec } from '../../format'
import { createFfmpegEncodeSink } from '../sink'

const ENCODERS_OUTPUT = `Encoders:
 V..... = Video
 A..... = Audio
 ------
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 VF...D png                  PNG (Portable Network Graphics) image
 V....D libvpx-vp9           libvpx VP9 (codec vp9)
 A....D aac                  AAC (Advanced Audio Coding)
 VFS..D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
`

function fakeFfmpeg(encoders: string[]): FfmpegBinary {
  return { path: '/usr/bin/ffmpeg', versionLine: 'ffmpeg version 6.1.1', version: [6, 1], encoders: new Set(encoders) }
}

describe('parseFfmpegVersion', () => {
  it('reads release, n-prefixed and distro versions', () => {
    expect(parseFfmpegVersion('ffmpeg version 6.1.1-essentials_build-www.gyan.dev Copyright')).toEqual([6, 1])
    expect(parseFfmpegVersion('ffmpeg version n7.0 Copyright')).toEqual([7, 0])
    expect(parseFfmpegVersion('ffmpeg version 4.4.2-0ubuntu0.22.04.1 Copyright')).toEqual([4, 4])
  })

  it('returns null for git builds with no numeric version', () => {
    expect(parseFfmpegVersion('ffmpeg version N-118234-g0abcdef Copyright')).toBeNull()
  })

  it('only reads the first line', () => {
    expect(parseFfmpegVersion('ffmpeg version N-1\nlibavutil version 58.2')).toBeNull()
  })
})

describe('parseEncoders', () => {
  it('lists encoders whose flag columns are set, and skips the legend', () => {
    const encoders = parseEncoders(ENCODERS_OUTPUT)
    expect([...encoders].sort()).toEqual(['aac', 'h264_nvenc', 'libvpx-vp9', 'libx264', 'png'])
  })
})

describe('locateFfmpeg', () => {
  it('fails with an install hint when the binary does not exist', async () => {
    const err = await locateFfmpeg({ ffmpegPath: join(tmpdir(), 'no-such-ffmpeg-binary') }).catch((e) => e)
    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).message).toMatch(/No ffmpeg found.*--ffmpeg/s)
  })
})

describe('pickEncoder', () => {
  const full = fakeFfmpeg(['libx264', 'libx265', 'libaom-av1', 'libvpx-vp9', 'libvpx', 'aac', 'libopus'])
  const mp4 = (videoCodec: VideoCodec) => ({ container: 'mp4' as const, videoCodec })
  const webm = (videoCodec: VideoCodec) => ({ container: 'webm' as const, videoCodec })

  it('uses ffmpeg with the codec and container encoders when it can', () => {
    expect(pickEncoder('auto', mp4('avc'), full)).toEqual({
      encoder: 'ffmpeg',
      ffmpeg: full,
      videoEncoder: 'libx264',
      audioEncoder: 'aac',
    })
    expect(pickEncoder('ffmpeg', mp4('hevc'), full)).toMatchObject({ videoEncoder: 'libx265', audioEncoder: 'aac' })
    expect(pickEncoder('ffmpeg', webm('vp9'), full)).toMatchObject({ videoEncoder: 'libvpx-vp9', audioEncoder: 'libopus' })
    expect(pickEncoder('ffmpeg', webm('vp8'), full)).toMatchObject({ videoEncoder: 'libvpx', audioEncoder: 'libopus' })
  })

  it('takes the first AV1 encoder the build has', () => {
    expect(pickEncoder('ffmpeg', mp4('av1'), full)).toMatchObject({ videoEncoder: 'libaom-av1' })
    const svt = fakeFfmpeg(['libsvtav1', 'libaom-av1', 'aac'])
    expect(pickEncoder('ffmpeg', mp4('av1'), svt)).toMatchObject({ videoEncoder: 'libsvtav1' })
  })

  it('never touches ffmpeg for chrome', () => {
    expect(pickEncoder('chrome', mp4('avc'), full)).toEqual({ encoder: 'chrome' })
    expect(pickEncoder('chrome', mp4('avc'), undefined)).toEqual({ encoder: 'chrome' })
  })

  it('auto falls back to chrome and says why', () => {
    expect(pickEncoder('auto', mp4('avc'), new CliError('No ffmpeg found.'))).toEqual({
      encoder: 'chrome',
      fallbackReason: 'No ffmpeg found.',
    })
    expect(pickEncoder('auto', mp4('avc'), fakeFfmpeg(['aac']))).toMatchObject({
      encoder: 'chrome',
      fallbackReason: /no avc encoder (looked for libx264)/,
    })
    expect(pickEncoder('auto', mp4('avc'), fakeFfmpeg(['libx264']))).toMatchObject({
      encoder: 'chrome',
      fallbackReason: /no 'aac' audio encoder for mp4/,
    })
    expect(pickEncoder('auto', webm('vp9'), fakeFfmpeg(['libvpx-vp9', 'aac']))).toMatchObject({
      encoder: 'chrome',
      fallbackReason: /no 'libopus' audio encoder for webm/,
    })
  })

  it('an explicit ffmpeg that cannot be honoured throws', () => {
    expect(() => pickEncoder('ffmpeg', mp4('avc'), new CliError('No ffmpeg found.'))).toThrow(CliError)
    expect(() => pickEncoder('ffmpeg', mp4('av1'), fakeFfmpeg(['aac']))).toThrow(/looked for libsvtav1, libaom-av1/)
  })
})

describe('buildPngEncoderArgs', () => {
  const base: PngEncoderInit = {
    ffmpeg: fakeFfmpeg(['libx264', 'aac']),
    outPath: '/tmp/out.mp4',
    container: 'mp4',
    fps: 30,
    videoEncoder: 'libx264',
    videoBitrate: 8_000_000,
    audioEncoder: 'aac',
    audio: null,
  }
  const audio = { path: '/tmp/audio.f32', sampleRate: 44_100, channels: 2, bitrate: 128_000 }

  it('reads PNGs from stdin and writes a BT.709-tagged yuv420p MP4 with no audio', () => {
    const args = buildPngEncoderArgs(base)
    expect(args.join(' ')).toContain('-f image2pipe -framerate 30 -c:v png -i pipe:0')
    expect(args.join(' ')).toContain('-c:v libx264 -b:v 8000000 -pix_fmt yuv420p -colorspace bt709')
    expect(args).toContain('-an')
    expect(args.join(' ')).toContain('-movflags +faststart')
    expect(args.slice(-3)).toEqual(['-f', 'mp4', '/tmp/out.mp4'])
  })

  it('adds the raw f32le audio mix as input 1, maps it, and keeps its rate in MP4', () => {
    const args = buildPngEncoderArgs({ ...base, audio }).join(' ')
    expect(args).toContain('-f f32le -ar 44100 -ac 2 -i /tmp/audio.f32')
    expect(args).toContain('-map 0:v:0 -map 1:a:0')
    expect(args).toContain('-c:a aac -b:a 128000 -movflags')
    expect(args).not.toContain('-an')
  })

  it('writes WebM with Opus resampled to 48 kHz and no MP4 flags', () => {
    const args = buildPngEncoderArgs({
      ...base,
      container: 'webm',
      outPath: '/tmp/out.webm',
      videoEncoder: 'libvpx-vp9',
      audioEncoder: 'libopus',
      audio,
    })
    expect(args.join(' ')).toContain('-c:v libvpx-vp9 -row-mt 1 -b:v')
    expect(args.join(' ')).toContain('-c:a libopus -b:a 128000 -ar 48000')
    expect(args).not.toContain('-movflags')
    expect(args.slice(-3)).toEqual(['-f', 'webm', '/tmp/out.webm'])
  })

  it('tags HEVC as hvc1 for Apple players', () => {
    expect(buildPngEncoderArgs({ ...base, videoEncoder: 'libx265' }).join(' ')).toContain('-c:v libx265 -tag:v hvc1')
  })
})

describe('interleaveF32', () => {
  it('interleaves planar channels frame by frame', () => {
    const out = interleaveF32([new Float32Array([1, 2, 3]), new Float32Array([-1, -2, -3])], 3)
    expect(Array.from(new Float32Array(out.buffer, out.byteOffset, 6))).toEqual([1, -1, 2, -2, 3, -3])
  })
})

/**
 * Real ffmpeg: opt in by pointing ELAH_FFMPEG at a binary, e.g.
 *   ELAH_FFMPEG=/usr/bin/ffmpeg npm test --workspace=packages/cli
 */
const ffmpegPath = process.env.ELAH_FFMPEG

describe.runIf(!!ffmpegPath)('ffmpeg encode (ELAH_FFMPEG set)', () => {
  /** Concatenated PNGs, as the harness streams them, made by ffmpeg itself. */
  function testPngs(frames: number): Buffer {
    return execFileSync(ffmpegPath!, [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=30',
      '-frames:v', String(frames), '-f', 'image2pipe', '-c:v', 'png', 'pipe:1',
    ])
  }

  it('locates the binary and lists libx264 + aac', async () => {
    const ffmpeg = await locateFfmpeg()
    expect(ffmpeg.encoders.has('libx264')).toBe(true)
    expect(ffmpeg.encoders.has('aac')).toBe(true)
  })

  it('encodes PNG frames plus an audio mix into an MP4 through the sink', async () => {
    const { probeMedia } = await import('../../probe')
    const ffmpeg = await locateFfmpeg()
    const sink = await createFfmpegEncodeSink({
      ffmpeg,
      container: 'mp4',
      videoEncoder: 'libx264',
      audioEncoder: 'aac',
      fps: 30,
      videoBitrate: 1_000_000,
      audioBitrate: 128_000,
    })
    try {
      const length = 48_000
      const tone = new Float32Array(length).map((_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / 48_000))
      const planar = Buffer.concat([Buffer.from(tone.buffer), Buffer.from(tone.buffer)])
      await sink.audio({ sampleRate: 48_000, channels: 2, length }, planar)
      await sink.frame(testPngs(30))
      const bytes = await sink.finish()

      const out = join(mkdtempSync(join(tmpdir(), 'elah-ffmpeg-')), 'out.mp4')
      writeFileSync(out, bytes)
      expect(readFileSync(out).subarray(4, 8).toString()).toBe('ftyp')
      const info = await probeMedia(out)
      expect(info.durationSec).toBeCloseTo(1.0, 1)
      expect(info.width).toBe(64)
      expect(info.height).toBe(48)
    } finally {
      await sink.dispose()
    }
  }, 60_000)

  it('encodes a VP9 + Opus WebM through the sink', async () => {
    const mb = await import('mediabunny')
    const ffmpeg = await locateFfmpeg()
    const sink = await createFfmpegEncodeSink({
      ffmpeg,
      container: 'webm',
      videoEncoder: 'libvpx-vp9',
      audioEncoder: 'libopus',
      fps: 30,
      videoBitrate: 1_000_000,
      audioBitrate: 96_000,
    })
    try {
      // 44.1 kHz in, as core's mix often is: the encoder must resample for Opus.
      const length = 44_100
      await sink.audio({ sampleRate: 44_100, channels: 1, length }, Buffer.alloc(length * 4))
      await sink.frame(testPngs(30))
      const out = join(mkdtempSync(join(tmpdir(), 'elah-ffmpeg-')), 'out.webm')
      writeFileSync(out, await sink.finish())

      const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.FilePathSource(out) })
      try {
        expect((await input.getFormat()).name).toMatch(/webm/i)
        expect((await input.getPrimaryVideoTrack())?.codec).toBe('vp9')
        expect((await input.getPrimaryAudioTrack())?.codec).toBe('opus')
        expect(await input.computeDuration()).toBeCloseTo(1.0, 1)
      } finally {
        input.dispose?.()
      }
    } finally {
      await sink.dispose()
    }
  }, 60_000)

  it('surfaces ffmpeg stderr when the input is not PNG', async () => {
    const ffmpeg = await locateFfmpeg()
    const outDir = mkdtempSync(join(tmpdir(), 'elah-ffmpeg-'))
    const encoder = PngFrameEncoder.start({
      ffmpeg,
      outPath: join(outDir, 'bad.mp4'),
      container: 'mp4',
      fps: 30,
      videoEncoder: 'libx264',
      videoBitrate: 1_000_000,
      audioEncoder: 'aac',
      audio: null,
    })
    await encoder.writeFrame(Buffer.from('definitely not a png')).catch(() => {})
    const err = await encoder.finish().catch((e) => e)
    expect(err).toBeInstanceOf(CliError)
    expect((err as CliError).message).toMatch(/ffmpeg exited with code/)
  }, 30_000)
})
