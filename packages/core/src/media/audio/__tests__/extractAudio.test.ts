import { describe, expect, it, vi } from 'vitest'
import { extractAudioForTranscription, NO_AUDIO_TRACK, type MediabunnyLike } from '../extractAudio'

function fakeMb(opts: { opus?: boolean; valid?: boolean; total?: number; onExecute?: () => Promise<void> } = {}) {
  const calls = {
    init: null as any,
    format: '' as string,
    cancel: vi.fn(),
    dispose: vi.fn(),
  }
  const buffer = new Uint8Array([1, 2, 3]).buffer
  class Input {
    constructor(public o: unknown) {}
    computeDuration = async () => opts.total ?? 100
    dispose = calls.dispose
  }
  class BlobSource { constructor(public b: Blob) {} }
  class BufferTarget { buffer: ArrayBuffer | null = buffer }
  class Output { constructor(o: { format: { kind: string } }) { calls.format = o.format.kind } }
  class OggOutputFormat { kind = 'ogg' }
  class WavOutputFormat { kind = 'wav' }
  const Conversion = {
    init: async (o: unknown) => {
      calls.init = o
      return { isValid: opts.valid !== false, execute: opts.onExecute ?? (async () => {}), cancel: calls.cancel }
    },
  }
  const mb = {
    Input, BlobSource, BufferTarget, Output, OggOutputFormat, WavOutputFormat, Conversion,
    ALL_FORMATS: [],
    canEncodeAudio: async () => opts.opus !== false,
  } as unknown as MediabunnyLike
  return { mb, calls }
}

const src = new Blob(['x'])

describe('extractAudioForTranscription', () => {
  it('picks Ogg/Opus when the browser can encode it', async () => {
    const { mb, calls } = fakeMb({ opus: true })
    const out = await extractAudioForTranscription(src, { startSec: 1, endSec: 5 }, { mb })
    expect(out.ext).toBe('ogg')
    expect(out.mime).toBe('audio/ogg')
    expect(calls.format).toBe('ogg')
    expect(calls.init.audio).toMatchObject({ codec: 'opus', numberOfChannels: 1, sampleRate: 16000 })
  })

  it('falls back to WAV pcm-s16 when Opus is unsupported', async () => {
    const { mb, calls } = fakeMb({ opus: false })
    const out = await extractAudioForTranscription(src, { startSec: 1, endSec: 5 }, { mb })
    expect(out.ext).toBe('wav')
    expect(calls.format).toBe('wav')
    expect(calls.init.audio).toMatchObject({ codec: 'pcm-s16', numberOfChannels: 1, sampleRate: 16000 })
  })

  it('forwards the trim range and discards video', async () => {
    const { mb, calls } = fakeMb()
    await extractAudioForTranscription(src, { startSec: 12.5, endSec: 30 }, { mb })
    expect(calls.init.trim).toEqual({ start: 12.5, end: 30 })
    expect(calls.init.video).toEqual({ discard: true })
  })

  it('clamps the range to the source duration and reports the clamped length', async () => {
    const { mb, calls } = fakeMb({ total: 20 })
    const out = await extractAudioForTranscription(src, { startSec: 15, endSec: 99 }, { mb })
    expect(calls.init.trim).toEqual({ start: 15, end: 20 })
    expect(out.durationSec).toBe(5)
  })

  it('rejects an empty range', async () => {
    const { mb } = fakeMb({ total: 10 })
    await expect(extractAudioForTranscription(src, { startSec: 10, endSec: 12 }, { mb })).rejects.toThrow('empty range')
  })

  it('maps a conversion with no audio track to NO_AUDIO_TRACK', async () => {
    const { mb, calls } = fakeMb({ valid: false })
    await expect(extractAudioForTranscription(src, { startSec: 0, endSec: 5 }, { mb })).rejects.toThrow(NO_AUDIO_TRACK)
    expect(calls.dispose).toHaveBeenCalled()
  })

  it('cancels the conversion on abort', async () => {
    const controller = new AbortController()
    let release!: () => void
    const { mb, calls } = fakeMb({ onExecute: () => new Promise<void>((r) => { release = r }) })
    const p = extractAudioForTranscription(src, { startSec: 0, endSec: 5 }, { mb, signal: controller.signal })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    controller.abort()
    release()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls.cancel).toHaveBeenCalled()
  })
})
