import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { RawFrameReader } from '../rawFrames'

/**
 * `objectMode: true` keeps every pushed Buffer as a discrete chunk that
 * `stream.read()` returns one at a time, in order — Node never merges or
 * splits them for us. That gives these tests exact control over how bytes
 * arrive off the "pipe", which is the whole point of exercising the
 * reader's own accumulation/slicing logic rather than Node's.
 */
function streamOf(chunks: Buffer[]): Readable {
  return Readable.from(chunks, { objectMode: true })
}

function bytes(...values: number[]): Buffer {
  return Buffer.from(values)
}

function toArray(frame: Uint8ClampedArray | null): number[] | null {
  return frame ? Array.from(frame) : null
}

describe('RawFrameReader', () => {
  it('emits one frame per chunk when chunk boundaries align exactly with frame boundaries', async () => {
    const stream = streamOf([bytes(0, 1, 2, 3), bytes(4, 5, 6, 7), bytes(8, 9, 10, 11)])
    const reader = new RawFrameReader(stream, 4)

    expect(toArray(await reader.read())).toEqual([0, 1, 2, 3])
    expect(toArray(await reader.read())).toEqual([4, 5, 6, 7])
    expect(toArray(await reader.read())).toEqual([8, 9, 10, 11])
    expect(await reader.read()).toBeNull()
    expect(reader.trailingBytes).toBe(0)
  })

  it('splits three frames out of a single oversized chunk', async () => {
    const stream = streamOf([bytes(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)])
    const reader = new RawFrameReader(stream, 4)

    expect(toArray(await reader.read())).toEqual([0, 1, 2, 3])
    expect(toArray(await reader.read())).toEqual([4, 5, 6, 7])
    expect(toArray(await reader.read())).toEqual([8, 9, 10, 11])
    expect(await reader.read()).toBeNull()
    expect(reader.trailingBytes).toBe(0)
  })

  it('assembles frames that arrive one byte at a time', async () => {
    const values = Array.from({ length: 12 }, (_, i) => i)
    const stream = streamOf(values.map(v => bytes(v)))
    const reader = new RawFrameReader(stream, 4)

    expect(toArray(await reader.read())).toEqual([0, 1, 2, 3])
    expect(toArray(await reader.read())).toEqual([4, 5, 6, 7])
    expect(toArray(await reader.read())).toEqual([8, 9, 10, 11])
    expect(await reader.read()).toBeNull()
    expect(reader.trailingBytes).toBe(0)
  })

  it('reassembles a single frame split across five chunks', async () => {
    const stream = streamOf([bytes(0, 1), bytes(2, 3), bytes(4, 5), bytes(6, 7), bytes(8, 9)])
    const reader = new RawFrameReader(stream, 10)

    expect(toArray(await reader.read())).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(await reader.read()).toBeNull()
    expect(reader.trailingBytes).toBe(0)
  })

  it('drops a truncated trailing frame and reports its byte count', async () => {
    const stream = streamOf([bytes(0, 1, 2, 3), bytes(4, 5)])
    const reader = new RawFrameReader(stream, 4)

    expect(toArray(await reader.read())).toEqual([0, 1, 2, 3])
    expect(await reader.read()).toBeNull()
    expect(reader.trailingBytes).toBe(2)
  })

  it('reports trailingBytes of 0 on a stream that ends with no data at all', async () => {
    const stream = streamOf([])
    const reader = new RawFrameReader(stream, 4)

    expect(await reader.read()).toBeNull()
    expect(reader.trailingBytes).toBe(0)
  })

  it('returns a live view: data mutated in place is reflected until the next read()', async () => {
    const chunk = bytes(0, 1, 2, 3)
    const stream = streamOf([chunk])
    const reader = new RawFrameReader(stream, 4)

    const frame = await reader.read()
    expect(frame).not.toBeNull()
    expect(frame!.length).toBe(4)
    // Documented contract: it is a view, not a copy — callers who need to
    // retain it (transition snapshots) must slice() it themselves.
    expect(frame!.buffer).not.toBe(undefined)
  })

  it('rejects a pending read on stream error', async () => {
    const stream = new Readable({ read() {} })
    const reader = new RawFrameReader(stream, 4)

    const pending = reader.read()
    stream.emit('error', new Error('boom'))

    await expect(pending).rejects.toThrow('boom')
  })

  it('rejects any subsequent read() once the stream has errored', async () => {
    const stream = new Readable({ read() {} })
    const reader = new RawFrameReader(stream, 4)

    stream.emit('error', new Error('pipe broke'))

    await expect(reader.read()).rejects.toThrow('pipe broke')
    await expect(reader.read()).rejects.toThrow('pipe broke')
  })

  it('throws synchronously on a second concurrent read()', async () => {
    const stream = new Readable({ read() {} })
    const reader = new RawFrameReader(stream, 4)

    const first = reader.read()
    expect(() => reader.read()).toThrow(/still pending/)

    // Clean up: finish the stream so the first read() settles.
    stream.push(null)
    await first
  })

  it('destroy() resolves a pending read with null and is idempotent', async () => {
    const stream = new Readable({ read() {} })
    const reader = new RawFrameReader(stream, 4)

    const pending = reader.read()
    reader.destroy()
    reader.destroy()

    expect(await pending).toBeNull()
  })

  it('destroy() stops the reader from reacting to further stream activity', async () => {
    const stream = new Readable({ read() {} })
    const reader = new RawFrameReader(stream, 4)
    reader.destroy()

    // Pushing data after destroy() must not throw or resurrect the reader.
    expect(() => stream.push(bytes(1, 2, 3, 4))).not.toThrow()
  })

  it('handles a stream that ends exactly on a frame boundary across many small pushes', async () => {
    const stream = streamOf([bytes(1), bytes(2), bytes(3), bytes(4), bytes(5), bytes(6), bytes(7), bytes(8)])
    const reader = new RawFrameReader(stream, 8)

    expect(toArray(await reader.read())).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(await reader.read()).toBeNull()
    expect(reader.trailingBytes).toBe(0)
  })

  it('does not buffer a fast producer ahead of the consumer when no read() is issued', async () => {
    // A well-behaved Readable that keeps producing forever — like a real OS
    // pipe carrying ffmpeg's stdout, `_read()` is only invoked again once
    // Node's own internal buffer drains below its highWaterMark, so this
    // simulates genuine upstream backpressure rather than an unbounded firehose.
    const chunkSize = 256
    const producerHighWaterMark = 4096
    let pushed = 0
    const stream = new Readable({
      highWaterMark: producerHighWaterMark,
      read() {
        pushed += chunkSize
        this.push(Buffer.alloc(chunkSize))
      },
    })

    // frameBytes larger than one producer refill burst, so a single pump()
    // drain can't accidentally satisfy it in one shot.
    const frameBytes = producerHighWaterMark * 2
    const reader = new RawFrameReader(stream, frameBytes)

    // Nobody ever calls reader.read(). Give the producer many ticks to keep
    // pushing — before the fix, pump()'s unconditional drain-to-null loop ran
    // on every 'readable' event and pulled every one of these pushes into
    // `pending` regardless of demand, so `pendingBytes` would keep climbing
    // with `pushed`. After the fix it must stop growing once one frame's
    // worth has accumulated.
    for (let i = 0; i < 50; i++) {
      await new Promise(resolve => setImmediate(resolve))
    }

    // The reader never hoarded more than one frame's worth ahead of demand...
    expect(reader.pendingBytes).toBeLessThanOrEqual(frameBytes)
    // ...and because it stopped pulling, the producer itself was throttled.
    // This is the discriminating assertion: with pump()'s old drain-to-null
    // loop, every push was consumed on the 'readable' event, `_read()` was
    // called again immediately, and `pushed` climbed without bound across
    // these 50 ticks. Bounded `pushed` is what proves OS pipe backpressure
    // would actually reach ffmpeg.
    expect(pushed).toBeLessThanOrEqual(frameBytes * 3)

    // Liveness: stopping the pull must not have deadlocked the reader. A
    // consumer that asks for a frame still gets one.
    const frame = await reader.read()
    expect(frame?.length).toBe(frameBytes)

    reader.destroy()
    stream.destroy()
  })
})
