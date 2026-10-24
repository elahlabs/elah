/**
 * PV-P9a-2: the PNG-sequence protocol — `FrameAckGate` (the worker's own
 * backpressure primitive), `createPngFrameReceiver` (the main thread's
 * validating writer), and `exportVideo`'s actual `container: 'png-sequence'`
 * path driven end-to-end against a fake `Worker`, exactly the technique
 * `exportFonts.test.ts` uses for the MP4 path.
 *
 * "Bounded" is proved, not asserted: the memory-bound test below tracks how
 * many frame writes are concurrently in flight through the REAL production
 * code (`exportVideo.ts`'s `png-frame` handler + `createPngFrameReceiver`),
 * driven by a fake worker that only sends frame i+1 after seeing the real
 * `png-ack` for frame i — the same contract the real ExportWorker's
 * `FrameAckGate` enforces. A version of the handler that acked before the
 * write settled would let this test's simulated worker race ahead and the
 * peak would rise above 1; see the mutation note in the ticket's Result.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportVideo } from '../exportVideo'
import { TimelineEngine } from '../../editor/TimelineEngine'
import { FrameAckGate, createPngFrameReceiver, pngFrameName } from '../pngSink'
import type { FrameSink } from '../types'

// ---------------------------------------------------------------------------
// FrameAckGate — worker-side backpressure primitive
// ---------------------------------------------------------------------------

describe('FrameAckGate', () => {
  it('throws synchronously when a second frame is expect()-ed before the first is acknowledged', () => {
    const gate = new FrameAckGate()
    gate.expect(0)
    expect(() => gate.expect(1)).toThrow(/never acknowledged/)
  })

  it('resolves expect() when the matching ack arrives', async () => {
    const gate = new FrameAckGate()
    const waiter = gate.expect(0)
    gate.ack(0)
    await expect(waiter).resolves.toBeUndefined()
  })

  it('an ack with a mismatched index throws and rejects the pending frame', async () => {
    const gate = new FrameAckGate()
    const waiter = gate.expect(0)
    expect(() => gate.ack(1)).toThrow(/mismatch/)
    await expect(waiter).rejects.toThrow(/mismatch/)
  })

  it('an ack with nothing pending throws', () => {
    const gate = new FrameAckGate()
    expect(() => gate.ack(0)).toThrow(/no frame is pending/)
  })

  it('after a mismatch is resolved (thrown + rejected), the gate accepts the next frame normally', async () => {
    const gate = new FrameAckGate()
    const waiter = gate.expect(0)
    expect(() => gate.ack(1)).toThrow()
    await expect(waiter).rejects.toThrow()
    // The gate is not stuck — a fresh frame can be posted and acked.
    const next = gate.expect(5)
    gate.ack(5)
    await expect(next).resolves.toBeUndefined()
  })

  it('fail() rejects the pending expect() with the given reason', async () => {
    const gate = new FrameAckGate()
    const waiter = gate.expect(0)
    gate.fail(new Error('aborted'))
    await expect(waiter).rejects.toThrow('aborted')
  })
})

// ---------------------------------------------------------------------------
// createPngFrameReceiver — main-thread validating writer
// ---------------------------------------------------------------------------

describe('createPngFrameReceiver', () => {
  function recordingSink(): { sink: FrameSink; written: Array<[string, Uint8Array]> } {
    const written: Array<[string, Uint8Array]> = []
    return {
      written,
      sink: {
        write: async (name, data) => {
          written.push([name, data])
        },
        close: async () => {},
        abort: async () => {},
      },
    }
  }

  it('writes frames to the sink in order', async () => {
    const { sink, written } = recordingSink()
    const receiver = createPngFrameReceiver(sink)
    await receiver.receive({ index: 0, name: 'frame-000001.png', data: new Uint8Array([1]) })
    await receiver.receive({ index: 1, name: 'frame-000002.png', data: new Uint8Array([2]) })
    expect(written.map(([n]) => n)).toEqual(['frame-000001.png', 'frame-000002.png'])
  })

  it('rejects an out-of-order index and never writes it', async () => {
    const { sink, written } = recordingSink()
    const receiver = createPngFrameReceiver(sink)
    await receiver.receive({ index: 0, name: 'frame-000001.png', data: new Uint8Array([1]) })
    await expect(
      receiver.receive({ index: 2, name: 'frame-000003.png', data: new Uint8Array([3]) }),
    ).rejects.toThrow(/out of order/)
    expect(written).toHaveLength(1)
  })

  it('proves "two frames cannot be posted before the first ack": a second frame arriving while the first write is still pending is rejected, not queued', async () => {
    let resolveFirstWrite!: () => void
    const order: string[] = []
    const sink: FrameSink = {
      write: async (name) => {
        order.push(`write-start:${name}`)
        if (name === 'frame-000001.png') {
          await new Promise<void>((r) => (resolveFirstWrite = r))
        }
        order.push(`write-end:${name}`)
      },
      close: async () => {},
      abort: async () => {},
    }
    const receiver = createPngFrameReceiver(sink)
    const firstReceive = receiver.receive({ index: 0, name: 'frame-000001.png', data: new Uint8Array([1]) })
    // Frame 1 arrives (a misbehaving worker that did not wait for the ack)
    // WHILE frame 0's write is still in flight.
    const secondReceive = receiver.receive({ index: 1, name: 'frame-000002.png', data: new Uint8Array([2]) })
    await expect(secondReceive).rejects.toThrow(/out of order/)
    resolveFirstWrite()
    await firstReceive
    expect(order).toEqual(['write-start:frame-000001.png', 'write-end:frame-000001.png'])
  })
})

// ---------------------------------------------------------------------------
// exportVideo — the real container: 'png-sequence' path, against a fake Worker
// ---------------------------------------------------------------------------

/** Records every postMessage payload and lets a test drive the worker's replies (pattern from exportFonts.test.ts). */
class FakeWorker {
  static last: FakeWorker | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: { message: string }) => void) | null = null
  readonly posted: unknown[] = []
  terminated = false
  /** Test hook: called with every message this worker "sends" to the main thread's postMessage — i.e. every reply FROM the main thread TO the worker. */
  onPost: ((data: unknown) => void) | null = null

  constructor() {
    FakeWorker.last = this
  }
  postMessage(data: unknown): void {
    this.posted.push(data)
    // Real postMessage delivery is always asynchronous (a structured-clone
    // hop across threads) — deferred here via a macrotask rather than
    // called inline, so a handler that (incorrectly) acks before its write
    // settles lets the next frame's write actually start concurrently,
    // instead of a synchronous call-stack recursion masking the overlap.
    if (this.onPost) {
      const cb = this.onPost
      setTimeout(() => cb(data), 0)
    }
  }
  terminate(): void {
    this.terminated = true
  }
  /** Deliver a worker→main message. */
  emit(data: unknown): void {
    this.onmessage?.({ data })
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

function pngProject() {
  const engine = new TimelineEngine({ fps: 30 })
  const track = engine.addTrack('elements', { name: 'Shapes' })
  engine.addClip({
    type: 'shape',
    shape: { shapeKind: 'rect' },
    trackId: track.id,
    startFrame: 0,
    durationFrames: 3,
  })
  return engine.getProject()
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeWorker.last = null
})

describe('exportVideo — container: "png-sequence" (PV-P9a-2)', () => {
  it('rejects an explicit videoCodec/audioCodec before a worker is ever spawned', async () => {
    await expect(
      exportVideo(pngProject(), { container: 'png-sequence', videoCodec: 'avc' }),
    ).rejects.toThrow(/no video\/audio codec/)
    expect(FakeWorker.last).toBeNull()
  })

  it('with no frameSink, buffers frames into a bounded ZIP and resolves an application/zip Blob containing them', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const enc = new TextEncoder()

    const done = exportVideo(pngProject(), { container: 'png-sequence' })
    await settle()
    const worker = FakeWorker.last!
    expect(worker).not.toBeNull()
    // frameSink must never appear on the posted start message (it's a function).
    const start = worker.posted[0] as { options?: Record<string, unknown> }
    expect(start.options?.frameSink).toBeUndefined()
    expect((start.options as { pngSinkMode?: boolean }).pngSinkMode).toBe(false)

    const frame0 = enc.encode('AAA')
    worker.emit({ type: 'png-frame', index: 0, name: pngFrameName(0), buffer: frame0.buffer })
    await settle()
    expect(worker.posted.at(-1)).toEqual({ type: 'png-ack', index: 0 })

    const frame1 = enc.encode('BBBB')
    worker.emit({ type: 'png-frame', index: 1, name: pngFrameName(1), buffer: frame1.buffer })
    await settle()
    expect(worker.posted.at(-1)).toEqual({ type: 'png-ack', index: 1 })

    worker.emit({ type: 'done', buffer: new ArrayBuffer(0), mimeType: 'application/octet-stream', container: 'png-sequence' })
    const blob = await done
    expect(blob.type).toBe('application/zip')
    expect(blob.size).toBeGreaterThan(0)
    expect(worker.terminated).toBe(true)

    // The archive genuinely contains both frames, byte-for-byte, at the
    // names the protocol assigned — read with the same minimal local zip
    // walker zipStore.test.ts uses (signature-driven, no assumptions about
    // this test's own encoder).
    const zipBytes = new Uint8Array(await blob.arrayBuffer())
    const entries = readZip(zipBytes)
    expect(entries.map((e) => e.name)).toEqual(['frame-000001.png', 'frame-000002.png'])
    expect(new TextDecoder().decode(entries[0]!.data)).toBe('AAA')
    expect(new TextDecoder().decode(entries[1]!.data)).toBe('BBBB')
  })

  it('with a frameSink, writes each frame to it and resolves an EMPTY application/octet-stream Blob', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const written: Array<[string, Uint8Array]> = []
    let closeCalls = 0
    const sink: FrameSink = {
      write: async (name, data) => {
        written.push([name, data])
      },
      close: async () => {
        closeCalls++
      },
      abort: async () => {},
    }

    const done = exportVideo(pngProject(), { container: 'png-sequence', frameSink: sink })
    await settle()
    const worker = FakeWorker.last!
    worker.emit({ type: 'png-frame', index: 0, name: pngFrameName(0), buffer: new Uint8Array([9, 9]).buffer })
    await settle()
    worker.emit({ type: 'done', buffer: new ArrayBuffer(0), mimeType: 'application/octet-stream', container: 'png-sequence' })
    const blob = await done

    expect(blob.type).toBe('application/octet-stream')
    expect(blob.size).toBe(0)
    expect(written).toEqual([['frame-000001.png', new Uint8Array([9, 9])]])
    expect(closeCalls).toBe(1)
  })

  it('a write rejection calls sink.abort() exactly once, never close(), and rejects the export', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    let abortCalls = 0
    let closeCalls = 0
    const sink: FrameSink = {
      write: async () => {
        throw new Error('disk full')
      },
      close: async () => {
        closeCalls++
      },
      abort: async () => {
        abortCalls++
      },
    }

    const done = exportVideo(pngProject(), { container: 'png-sequence', frameSink: sink })
    await settle()
    const worker = FakeWorker.last!
    worker.emit({ type: 'png-frame', index: 0, name: pngFrameName(0), buffer: new ArrayBuffer(4) })

    await expect(done).rejects.toThrow(/disk full/)
    expect(abortCalls).toBe(1)
    expect(closeCalls).toBe(0)
    expect(worker.terminated).toBe(true)

    // A second 'done'/'error' arriving after settlement must not call
    // abort() or close() again (the `settled` guard).
    worker.emit({ type: 'done', buffer: new ArrayBuffer(0), mimeType: 'application/octet-stream', container: 'png-sequence' })
    await settle()
    expect(abortCalls).toBe(1)
    expect(closeCalls).toBe(0)
  })

  it('aborting via signal while a frame write is pending settles promptly and calls sink.abort() exactly once', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    let abortCalls = 0
    let writeEverResolved = false
    const sink: FrameSink = {
      write: () =>
        new Promise<void>((resolve) => {
          // Never resolves on its own within the test — the abort must not
          // wait for it.
          setTimeout(() => {
            writeEverResolved = true
            resolve()
          }, 10_000)
        }),
      close: async () => {},
      abort: async () => {
        abortCalls++
      },
    }
    const controller = new AbortController()
    const done = exportVideo(pngProject(), { container: 'png-sequence', frameSink: sink, signal: controller.signal })
    await settle()
    const worker = FakeWorker.last!
    worker.emit({ type: 'png-frame', index: 0, name: pngFrameName(0), buffer: new ArrayBuffer(4) })
    await settle()

    controller.abort(new DOMException('cancelled', 'AbortError'))
    await expect(done).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(true)
    expect(abortCalls).toBe(1)
    expect(writeEverResolved).toBe(false)
  })

  it('bounded memory: never more than one frame write in flight, across many frames, through the real handler', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const FRAME_COUNT = 40
    let outstanding = 0
    let peak = 0
    const sink: FrameSink = {
      write: async () => {
        outstanding++
        peak = Math.max(peak, outstanding)
        // A real async sink (disk write / fetch) yields the microtask queue
        // at least once — if the handler posted the ack before this
        // resolved, the fake worker below would race ahead.
        await new Promise((r) => setTimeout(r, 0))
        outstanding--
      },
      close: async () => {},
      abort: async () => {},
    }

    const done = exportVideo(pngProject(), { container: 'png-sequence', frameSink: sink })
    await settle()
    const worker = FakeWorker.last!
    worker.onPost = (data) => {
      const msg = data as { type: string; index?: number }
      if (msg.type !== 'png-ack') return
      const next = (msg.index ?? -1) + 1
      if (next < FRAME_COUNT) {
        worker.emit({ type: 'png-frame', index: next, name: pngFrameName(next), buffer: new ArrayBuffer(4) })
      } else {
        worker.emit({ type: 'done', buffer: new ArrayBuffer(0), mimeType: 'application/octet-stream', container: 'png-sequence' })
      }
    }
    worker.emit({ type: 'png-frame', index: 0, name: pngFrameName(0), buffer: new ArrayBuffer(4) })

    await done
    expect(peak).toBeLessThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Local zip reader (mirrors zipStore.test.ts's minimal round-trip reader)
// ---------------------------------------------------------------------------

function u16(data: Uint8Array, at: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(at, true)
}
function u32(data: Uint8Array, at: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(at, true)
}
function readZip(zip: Uint8Array): Array<{ name: string; data: Uint8Array }> {
  const out: Array<{ name: string; data: Uint8Array }> = []
  let at = 0
  while (at < zip.length && u32(zip, at) === 0x04034b50) {
    const nameLen = u16(zip, at + 26)
    const dataLen = u32(zip, at + 18)
    const nameStart = at + 30
    const dataStart = nameStart + nameLen
    out.push({
      name: new TextDecoder().decode(zip.slice(nameStart, dataStart)),
      data: zip.slice(dataStart, dataStart + dataLen),
    })
    at = dataStart + dataLen
  }
  return out
}
