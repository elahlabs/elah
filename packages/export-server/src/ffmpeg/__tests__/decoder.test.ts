import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

import { spawn } from 'node:child_process'
import { buildDecoderArgs, ClipDecoder } from '../decoder'
import type { ClipDecoderInit } from '../decoder'
import type { FfmpegBinary, VideoFrameIndex } from '../../types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFfmpeg(): FfmpegBinary {
  return {
    path: '/usr/bin/ffmpeg',
    versionLine: 'ffmpeg version 6.0',
    version: [6, 0],
    encoders: new Set(['libx264']),
  }
}

function makeIndex(timestamps: number[]): VideoFrameIndex {
  return {
    durationSec: timestamps.length > 0 ? timestamps[timestamps.length - 1] : 0,
    displayWidth: 640,
    displayHeight: 360,
    codedWidth: 640,
    codedHeight: 360,
    averageFrameRate: 30,
    timestamps: Float64Array.from(timestamps),
    exact: true,
  }
}

/** Single-pixel rgba frames (frameBytes = 4) keep test fixtures tiny and readable. */
function makeInit(overrides: {
  sourceIndices: number[]
  timestamps?: number[]
}): ClipDecoderInit {
  return {
    ffmpeg: makeFfmpeg(),
    source: '/media/clip.mp4',
    index: makeIndex(overrides.timestamps ?? [0, 1 / 30, 2 / 30, 3 / 30, 4 / 30]),
    sourceIndices: Int32Array.from(overrides.sourceIndices),
    decodeWidth: 1,
    decodeHeight: 1,
    displayWidth: 640,
    displayHeight: 360,
  }
}

function frame(marker: number): Buffer {
  return Buffer.from([marker, marker, marker, marker])
}

/**
 * Minimal fake `ChildProcess`: real `PassThrough` streams for stdout/stderr so
 * `RawFrameReader` and `attachStderrTail` exercise their actual stream-event
 * logic, plus a `kill()` that mimics ffmpeg closing its pipes and emitting
 * 'close' once terminated — the two things `ClipDecoder` actually depends on.
 */
class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  kill(signal?: NodeJS.Signals): boolean {
    this.signalCode = signal ?? 'SIGTERM'
    queueMicrotask(() => {
      this.stdout.end()
      this.emit('close', null, this.signalCode)
    })
    return true
  }
}

function useFakeChild(): FakeChild {
  const child = new FakeChild()
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
  return child
}

beforeEach(() => {
  vi.mocked(spawn).mockReset()
})

// ---------------------------------------------------------------------------
// buildDecoderArgs — pure, no process involved
// ---------------------------------------------------------------------------

describe('buildDecoderArgs', () => {
  it('omits -ss entirely when the clip starts at source index 0', () => {
    const args = buildDecoderArgs(makeInit({ sourceIndices: [0, 1, 2] }))
    expect(args).not.toContain('-ss')
    expect(args).toEqual([
      '-hide_banner', '-nostdin', '-loglevel', 'error',
      '-i', '/media/clip.mp4',
      '-map', '0:v:0', '-an', '-sn', '-dn',
      '-vf', 'scale=1:1:flags=bicubic',
      '-fps_mode', 'passthrough',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
    ])
  })

  it('omits -ss when every source index is -1 (degenerate: clip never visible)', () => {
    const args = buildDecoderArgs(makeInit({ sourceIndices: [-1, -1, -1] }))
    expect(args).not.toContain('-ss')
  })

  it('seeks to the PTS midpoint before the first wanted frame when trimmed mid-source', () => {
    const timestamps = [0, 0.1, 0.2, 0.3, 0.4]
    const args = buildDecoderArgs(makeInit({ sourceIndices: [2, 3], timestamps }))
    const ssIndex = args.indexOf('-ss')
    expect(ssIndex).toBeGreaterThanOrEqual(0)
    const expectedMidpoint = ((timestamps[1] + timestamps[2]) / 2).toFixed(6)
    expect(args[ssIndex + 1]).toBe(expectedMidpoint)
    // -ss must precede -i, per the input-seek (accurate_seek) strategy.
    expect(args.indexOf('-i')).toBeGreaterThan(ssIndex)
  })

  it('rebases the seek against a non-zero first timestamp', () => {
    // mediabunny reports absolute track PTS; ffmpeg's input -ss is relative to
    // the container's start_time. A source whose first packet sits at 10s (an
    // MPEG-TS capture, an MP4 with an edit list, anything remuxed with
    // -copyts) must not be seeked to the absolute value, or every frame of the
    // clip is off by the same constant with no error raised.
    const offset = 10
    const relative = [0, 0.1, 0.2, 0.3]
    const absolute = relative.map(t => t + offset)

    const shifted = buildDecoderArgs(makeInit({ sourceIndices: [2, 3], timestamps: absolute }))
    const atOrigin = buildDecoderArgs(makeInit({ sourceIndices: [2, 3], timestamps: relative }))

    const ssIndex = shifted.indexOf('-ss')
    expect(ssIndex).toBeGreaterThanOrEqual(0)
    expect(shifted[ssIndex + 1]).toBe(((relative[1] + relative[2]) / 2).toFixed(6))
    // Same content, same seek — the offset must cancel out entirely.
    expect(shifted).toEqual(atOrigin)
  })

  it('clamps to 0 when the track starts at a negative timestamp', () => {
    // A negative first timestamp means the track's timing is offset; that is
    // already folded into the container's start_time, and ffmpeg has no
    // negative input seek.
    const args = buildDecoderArgs(makeInit({ sourceIndices: [2, 3], timestamps: [-0.2, -0.1, 0, 0.1] }))
    const ssIndex = args.indexOf('-ss')
    if (ssIndex >= 0) expect(Number(args[ssIndex + 1])).toBeGreaterThanOrEqual(0)
  })

  it('skips leading -1 entries to find k0 for the seek calculation', () => {
    const timestamps = [0, 0.1, 0.2]
    const withLeadingGap = buildDecoderArgs(makeInit({ sourceIndices: [-1, -1, 1], timestamps }))
    const withoutGap = buildDecoderArgs(makeInit({ sourceIndices: [1], timestamps }))
    // k0 is 1 either way, so the seek time (and the whole argv) must match.
    expect(withLeadingGap).toEqual(withoutGap)
  })

  it('scales to decodeWidth/decodeHeight, independent of display dimensions', () => {
    const init = makeInit({ sourceIndices: [0] })
    init.decodeWidth = 960
    init.decodeHeight = 540
    const args = buildDecoderArgs(init)
    expect(args).toContain('scale=960:540:flags=bicubic')
  })
})

// ---------------------------------------------------------------------------
// ClipDecoder — the dup/drop cursor, driven against a fake process
// ---------------------------------------------------------------------------

describe('ClipDecoder', () => {
  it('reads one frame per export frame with no dup/drop on a 1:1 plan', async () => {
    const child = useFakeChild()
    const decoder = ClipDecoder.open(makeInit({ sourceIndices: [0, 1, 2] }))

    child.stdout.write(frame(10))
    child.stdout.write(frame(11))
    child.stdout.write(frame(12))
    child.stdout.end()

    expect(Array.from((await decoder.next())!.data)).toEqual([10, 10, 10, 10])
    expect(Array.from((await decoder.next())!.data)).toEqual([11, 11, 11, 11])
    expect(Array.from((await decoder.next())!.data)).toEqual([12, 12, 12, 12])

    await decoder.close()
  })

  it('returns null without reading when the target is before the clip\'s first frame', async () => {
    const child = useFakeChild()
    const decoder = ClipDecoder.open(makeInit({ sourceIndices: [-1, -1, 0] }))

    expect(await decoder.next()).toBeNull()
    expect(await decoder.next()).toBeNull()

    child.stdout.write(frame(5))
    child.stdout.end()
    expect(Array.from((await decoder.next())!.data)).toEqual([5, 5, 5, 5])

    await decoder.close()
  })

  it('re-returns the held frame on a duplicate index (source slower than project rate)', async () => {
    const child = useFakeChild()
    const decoder = ClipDecoder.open(makeInit({ sourceIndices: [0, 0, 1] }))

    child.stdout.write(frame(9))
    child.stdout.end()

    const f0 = await decoder.next()
    const f1 = await decoder.next()
    expect(Array.from(f0!.data)).toEqual([9, 9, 9, 9])
    expect(f1!.data).toBe(f0!.data)

    // The plan wants source index 1 next, but the fake source only ever
    // produced index 0 — the clip is shorter than planned.
    expect(await decoder.next()).toBeNull()

    await decoder.close()
  })

  it('drops intermediate frames when want jumps ahead of cursor (source faster than project rate)', async () => {
    const child = useFakeChild()
    const decoder = ClipDecoder.open(makeInit({ sourceIndices: [0, 2] }))

    child.stdout.write(frame(1))
    child.stdout.write(frame(2))
    child.stdout.write(frame(3))
    child.stdout.end()

    expect(Array.from((await decoder.next())!.data)).toEqual([1, 1, 1, 1])
    // Source index 1 (marker 2) is pulled and discarded on the way to index 2.
    expect(Array.from((await decoder.next())!.data)).toEqual([3, 3, 3, 3])

    await decoder.close()
  })

  it('returns null once the source runs out before the plan is satisfied', async () => {
    const child = useFakeChild()
    const decoder = ClipDecoder.open(makeInit({ sourceIndices: [0, 1, 2] }))

    child.stdout.write(frame(1))
    child.stdout.end()

    expect(Array.from((await decoder.next())!.data)).toEqual([1, 1, 1, 1])
    expect(await decoder.next()).toBeNull()
    // Once exhausted, stays null rather than trying to read a dead stream again.
    expect(await decoder.next()).toBeNull()

    await decoder.close()
  })

  it('throws rather than seeking backwards on a non-decreasing violation', async () => {
    const child = useFakeChild()
    const decoder = ClipDecoder.open(makeInit({ sourceIndices: [2, 0] }))

    child.stdout.write(frame(7))

    expect(Array.from((await decoder.next())!.data)).toEqual([7, 7, 7, 7])
    await expect(decoder.next()).rejects.toMatchObject({ code: 'DECODE_FAILED' })

    await decoder.close()
  })

  it('throws when next() is called past the end of its plan', async () => {
    const child = useFakeChild()
    const decoder = ClipDecoder.open(makeInit({ sourceIndices: [0] }))

    child.stdout.write(frame(1))
    child.stdout.end()
    expect(Array.from((await decoder.next())!.data)).toEqual([1, 1, 1, 1])
    // The guard fires before touching the (now-idle) reader, so this must
    // reject rather than hang waiting on a frame nobody planned for.
    await expect(decoder.next()).rejects.toThrow(/past the end of its plan/)

    await decoder.close()
  })

  it('rejects a pending next() with DECODE_FAILED, including the stderr tail, on abnormal exit', async () => {
    const child = useFakeChild()
    const decoder = ClipDecoder.open(makeInit({ sourceIndices: [0, 1] }))

    child.stderr.write('some ffmpeg diagnostic\n')
    child.stdout.write(frame(1))
    // Let attachStderrTail's 'data' listener and the reader both settle
    // before the first next() resolves.
    await new Promise(resolve => setImmediate(resolve))
    expect(Array.from((await decoder.next())!.data)).toEqual([1, 1, 1, 1])

    const pending = decoder.next()
    child.emit('close', 1, null)

    await expect(pending).rejects.toMatchObject({ code: 'DECODE_FAILED' })
    await expect(pending.catch((err: Error) => err.message)).resolves.toContain('some ffmpeg diagnostic')

    await decoder.close()
  })

  it('does not treat close()\'s own SIGKILL as a decode failure', async () => {
    const child = useFakeChild()
    const decoder = ClipDecoder.open(makeInit({ sourceIndices: [0, 1, 2] }))

    child.stdout.write(frame(1))
    expect(Array.from((await decoder.next())!.data)).toEqual([1, 1, 1, 1])

    // close() kills mid-decode; the pending state must not surface as a
    // DECODE_FAILED rejection anywhere (no unhandled rejection either).
    await decoder.close()
  })

  it('close() is idempotent and only kills the process once', async () => {
    const child = useFakeChild()
    const killSpy = vi.spyOn(child, 'kill')
    const decoder = ClipDecoder.open(makeInit({ sourceIndices: [0] }))

    await Promise.all([decoder.close(), decoder.close()])
    expect(killSpy).toHaveBeenCalledTimes(1)
  })

  it('spawns with the exact argv built by buildDecoderArgs, exposed on .args', () => {
    const child = useFakeChild()
    const init = makeInit({ sourceIndices: [0, 1] })
    const decoder = ClipDecoder.open(init)

    expect(decoder.args).toEqual(buildDecoderArgs(init))
    expect(spawn).toHaveBeenCalledWith(init.ffmpeg.path, decoder.args, { stdio: ['ignore', 'pipe', 'pipe'] })
    void child
    void decoder.close()
  })
})
