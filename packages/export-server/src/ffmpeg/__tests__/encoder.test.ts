import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { FfmpegBinary, AudioMixSpec } from '../../types'
import type { EncoderInit } from '../encoder'

// ---------------------------------------------------------------------------
// child_process is mocked so these tests exercise the *real* FrameEncoder
// class (backpressure, exit races, error construction) against a fake
// process, instead of spawning actual ffmpeg. '../errors' is mocked too so
// this suite does not depend on that module's concrete shape, only the
// `new ExportServerError(code, message)` contract encoder.ts is written
// against.
// ---------------------------------------------------------------------------

const spawnMock = vi.fn()
vi.mock('node:child_process', () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }))

class FakeExportServerError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ExportServerError'
    this.code = code
  }
}
vi.mock('../errors', () => ({ ExportServerError: FakeExportServerError }))

const { FrameEncoder, buildEncoderArgs } = await import('../encoder')

const FFMPEG: FfmpegBinary = {
  path: '/usr/bin/ffmpeg',
  versionLine: 'ffmpeg version 6.1.1',
  version: [6, 1],
  encoders: new Set(['libx264', 'aac']),
}

function baseInit(overrides: Partial<EncoderInit> = {}): EncoderInit {
  return {
    ffmpeg: FFMPEG,
    outPath: '/tmp/out.mp4',
    width: 1920,
    height: 1080,
    fps: 30,
    videoEncoder: 'libx264',
    videoBitrate: 8_000_000,
    audio: null,
    ...overrides,
  }
}

function audioSpec(inputs: number): AudioMixSpec {
  return {
    inputs: Array.from({ length: inputs }, (_, i) => ({ source: `/media/a${i}.mp3`, clipId: `clip-${i}` })),
    filterComplex: '[1:a]atrim=start=0:end=1[a0];[a0]apad=whole_dur=1,atrim=end=1,asetpts=N/SR/TB[aout]',
    outLabel: '[aout]',
    sampleRate: 48000,
    channels: 2,
  }
}

describe('buildEncoderArgs', () => {
  it('video-only: -an, no filter_complex, rawvideo input dimensions match', () => {
    const args = buildEncoderArgs(baseInit())
    expect(args).toEqual([
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '1920x1080', '-r', '30', '-i', 'pipe:0',
      '-map', '0:v:0',
      '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709',
      '-c:v', 'libx264', '-b:v', '8000000', '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-an',
      '-movflags', '+faststart',
      '-f', 'mp4', '/tmp/out.mp4',
    ])
  })

  it('video + single audio: one -i after the rawvideo pipe, filter_complex + map + audio codec args', () => {
    const args = buildEncoderArgs(
      baseInit({ audio: { spec: audioSpec(1), encoder: 'aac', bitrate: 128_000 } }),
    )
    expect(args).toEqual([
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '1920x1080', '-r', '30', '-i', 'pipe:0',
      '-i', '/media/a0.mp3',
      '-filter_complex', '[1:a]atrim=start=0:end=1[a0];[a0]apad=whole_dur=1,atrim=end=1,asetpts=N/SR/TB[aout]',
      '-map', '[aout]',
      '-map', '0:v:0',
      '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709',
      '-c:v', 'libx264', '-b:v', '8000000', '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-c:a', 'aac', '-b:a', '128000', '-ar', '48000', '-ac', '2',
      '-movflags', '+faststart',
      '-f', 'mp4', '/tmp/out.mp4',
    ])
  })

  it('video + 3 audio inputs: three -i entries appended in order at indices 1..3', () => {
    const args = buildEncoderArgs(
      baseInit({ audio: { spec: audioSpec(3), encoder: 'aac', bitrate: 128_000 } }),
    )
    // rawvideo pipe is always input 0
    expect(args.slice(args.indexOf('-i'), args.indexOf('-i') + 2)).toEqual(['-i', 'pipe:0'])
    const audioInputs = []
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-i' && args[i + 1] !== 'pipe:0') audioInputs.push(args[i + 1])
    }
    expect(audioInputs).toEqual(['/media/a0.mp3', '/media/a1.mp3', '/media/a2.mp3'])
    expect(args).toContain('-filter_complex')
    expect(args[args.indexOf('-map') + 1]).toBe('[aout]')
  })

  it('places extraOutputArgs immediately before the trailing -f mp4 <outPath>', () => {
    const args = buildEncoderArgs(baseInit({ extraOutputArgs: ['-preset', 'veryfast'] }))
    expect(args.slice(-5)).toEqual(['-preset', 'veryfast', '-f', 'mp4', '/tmp/out.mp4'])
  })

  it('uses -b:v (never -crf) so videoBitrate carries the same meaning as ExportOptions', () => {
    const args = buildEncoderArgs(baseInit({ videoBitrate: 4_000_000 }))
    expect(args[args.indexOf('-b:v') + 1]).toBe('4000000')
    expect(args).not.toContain('-crf')
  })
})

// ---------------------------------------------------------------------------
// FrameEncoder — process plumbing, driven through a fake child process
// ---------------------------------------------------------------------------

class FakeStdin extends EventEmitter {
  written: Buffer[] = []
  ended = false
  full = false

  write(chunk: Buffer): boolean {
    this.written.push(chunk)
    return !this.full
  }

  end(): void {
    this.ended = true
  }
}

class FakeChildProcess extends EventEmitter {
  stdin = new FakeStdin()
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kill = vi.fn()
}

function makeFakeChild(): FakeChildProcess {
  const proc = new FakeChildProcess()
  spawnMock.mockReturnValue(proc)
  return proc
}

beforeEach(() => {
  spawnMock.mockReset()
})

describe('FrameEncoder.args', () => {
  it('matches buildEncoderArgs for the same init', () => {
    makeFakeChild()
    const init = baseInit()
    const encoder = FrameEncoder.start(init)
    expect(encoder.args).toEqual(buildEncoderArgs(init))
  })
})

describe('FrameEncoder.writeFrame backpressure', () => {
  it('resolves immediately when stdin.write() returns true', async () => {
    const proc = makeFakeChild()
    proc.stdin.full = false
    const encoder = FrameEncoder.start(baseInit())

    await expect(encoder.writeFrame(new Uint8ClampedArray([1, 2, 3, 4]))).resolves.toBeUndefined()
    expect(proc.stdin.written).toHaveLength(1)
    expect(Array.from(proc.stdin.written[0])).toEqual([1, 2, 3, 4])
  })

  it('does not resolve before drain when stdin.write() returns false', async () => {
    const proc = makeFakeChild()
    proc.stdin.full = true
    const encoder = FrameEncoder.start(baseInit())

    let resolved = false
    const pending = encoder.writeFrame(new Uint8ClampedArray(8)).then(() => {
      resolved = true
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(resolved).toBe(false)

    proc.stdin.emit('drain')
    await pending
    expect(resolved).toBe(true)
  })

  it('a second writeFrame behind a full pipe waits for its own drain, not the first', async () => {
    const proc = makeFakeChild()
    proc.stdin.full = true
    const encoder = FrameEncoder.start(baseInit())

    const first = encoder.writeFrame(new Uint8ClampedArray(8))
    proc.stdin.emit('drain')
    await first

    proc.stdin.full = true
    let secondResolved = false
    const second = encoder.writeFrame(new Uint8ClampedArray(8)).then(() => {
      secondResolved = true
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(secondResolved).toBe(false)

    proc.stdin.emit('drain')
    await second
    expect(secondResolved).toBe(true)
  })

  it('rejects instead of hanging forever if ffmpeg exits while a write is awaiting drain', async () => {
    const proc = makeFakeChild()
    proc.stdin.full = true
    const encoder = FrameEncoder.start(baseInit())

    const pending = encoder.writeFrame(new Uint8ClampedArray(8))
    proc.stderr.emit('data', Buffer.from('boom: unsupported codec\n'))
    proc.emit('close', 1, null)

    await expect(pending).rejects.toMatchObject({ code: 'ENCODE_FAILED' })
    await expect(pending).rejects.toThrow(/boom: unsupported codec/)
  })

  it('a subsequent writeFrame after failure rethrows the same captured error without touching stdin again', async () => {
    const proc = makeFakeChild()
    proc.stdin.full = true
    const encoder = FrameEncoder.start(baseInit())

    const first = encoder.writeFrame(new Uint8ClampedArray(8))
    proc.emit('close', 1, null)
    await expect(first).rejects.toMatchObject({ code: 'ENCODE_FAILED' })

    const writesBefore = proc.stdin.written.length
    await expect(encoder.writeFrame(new Uint8ClampedArray(8))).rejects.toMatchObject({ code: 'ENCODE_FAILED' })
    expect(proc.stdin.written.length).toBe(writesBefore)
  })
})

describe('FrameEncoder.finish', () => {
  it('ends stdin and resolves when ffmpeg exits 0', async () => {
    const proc = makeFakeChild()
    const encoder = FrameEncoder.start(baseInit())

    const pending = encoder.finish()
    proc.emit('close', 0, null)

    await expect(pending).resolves.toBeUndefined()
    expect(proc.stdin.ended).toBe(true)
  })

  it('rejects with an ENCODE_FAILED error carrying argv and the stderr tail on non-zero exit', async () => {
    const proc = makeFakeChild()
    const encoder = FrameEncoder.start(baseInit())

    const pending = encoder.finish()
    proc.stderr.emit('data', Buffer.from('some ffmpeg error\n'))
    proc.emit('close', 1, null)

    await expect(pending).rejects.toMatchObject({ code: 'ENCODE_FAILED' })
    await expect(pending).rejects.toThrow(/some ffmpeg error/)
    await expect(pending).rejects.toThrow(/ffmpeg exited with code 1/)
    await expect(pending).rejects.toThrow(/-hide_banner/) // argv included
  })
})

describe('FrameEncoder.abort', () => {
  it('SIGKILLs the process', () => {
    const proc = makeFakeChild()
    const encoder = FrameEncoder.start(baseInit())

    encoder.abort()

    expect(proc.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('is safe to call after finish() resolves', async () => {
    const proc = makeFakeChild()
    const encoder = FrameEncoder.start(baseInit())

    const pending = encoder.finish()
    proc.emit('close', 0, null)
    await pending

    expect(() => encoder.abort()).not.toThrow()
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('fires automatically when the provided AbortSignal aborts', () => {
    const proc = makeFakeChild()
    const controller = new AbortController()
    FrameEncoder.start(baseInit({ signal: controller.signal }))

    controller.abort()

    expect(proc.kill).toHaveBeenCalledWith('SIGKILL')
  })
})
