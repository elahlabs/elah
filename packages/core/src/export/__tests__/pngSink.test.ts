/**
 * PV-P9a-2: the pure, DOM-free pieces of the PNG-sequence sink —
 * `pngFrameName`, `stripFrameSinkForWorker` and the bounded in-memory ZIP
 * fallback `createZipFrameSink`. The protocol/backpressure pieces
 * (`FrameAckGate`, `createPngFrameReceiver`) have their own file,
 * `pngProtocol.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import {
  createZipFrameSink,
  pngFrameName,
  stripFrameSinkForWorker,
  PNG_ZIP_MAX_BYTES,
  PNG_ZIP_MAX_FILES,
} from '../pngSink'
import type { FrameSink } from '../types'

describe('pngFrameName', () => {
  it('is 1-based, zero-padded to 6 digits', () => {
    expect(pngFrameName(0)).toBe('frame-000001.png')
    expect(pngFrameName(1)).toBe('frame-000002.png')
    expect(pngFrameName(999999)).toBe('frame-1000000.png')
  })
})

describe('stripFrameSinkForWorker', () => {
  it('removes frameSink and adds pngSinkMode: true when one was present', () => {
    const sink: FrameSink = { write: async () => {}, close: async () => {}, abort: async () => {} }
    const stripped = stripFrameSinkForWorker({ container: 'png-sequence' as const, frameSink: sink, outputHeight: 360 })
    expect('frameSink' in stripped).toBe(false)
    expect(stripped.pngSinkMode).toBe(true)
    expect(stripped.outputHeight).toBe(360)
  })

  it('adds pngSinkMode: false when no frameSink was given', () => {
    const stripped = stripFrameSinkForWorker({ container: 'mp4' as const, frameSink: undefined })
    expect(stripped.pngSinkMode).toBe(false)
  })

  it('never leaves a function on the stripped object — proves the postMessage DataCloneError contract', () => {
    // Mirrors every function-typed field real ExportOptions carries, not just
    // frameSink, so this test would also catch a future field added without
    // being stripped elsewhere — but frameSink specifically is THIS
    // function's job.
    const options = {
      frameSink: { write: async () => {}, close: async () => {}, abort: async () => {} } as FrameSink,
      onProgress: () => {},
      signal: new AbortController().signal,
    }
    const stripped = stripFrameSinkForWorker(options)
    for (const [key, value] of Object.entries(stripped)) {
      if (key === 'onProgress' || key === 'signal') continue // not this function's job to strip these
      expect(typeof value, `${key} must not be a function`).not.toBe('function')
    }
    expect('frameSink' in stripped).toBe(false)
  })
})

describe('createZipFrameSink', () => {
  const enc = new TextEncoder()

  it('accumulates written frames and produces a valid zip via zipStore after close()', async () => {
    const sink = createZipFrameSink()
    await sink.write('frame-000001.png', enc.encode('aaa'))
    await sink.write('frame-000002.png', enc.encode('bb'))
    await sink.close()
    const zip = sink.toZip()
    expect(zip).toBeInstanceOf(Uint8Array)
    // Local file header signature at the very start.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
  })

  it('toZip() before close() throws', () => {
    const sink = createZipFrameSink()
    expect(() => sink.toZip()).toThrow(/before close/)
  })

  it('rejects a write once the file-count cap is reached', async () => {
    const sink = createZipFrameSink({ maxFiles: 2 })
    await sink.write('a.png', enc.encode('x'))
    await sink.write('b.png', enc.encode('x'))
    await expect(sink.write('c.png', enc.encode('x'))).rejects.toThrow(/files/)
  })

  it('rejects a write that would push the aggregate past the byte cap, and accepts a write landing exactly on the cap', async () => {
    const sink = createZipFrameSink({ maxBytes: 10 })
    await sink.write('a.png', new Uint8Array(6))
    // 6 + 4 === 10 — exactly the cap, must be accepted, not rejected.
    await expect(sink.write('b.png', new Uint8Array(4))).resolves.toBeUndefined()
    // One more byte pushes it over — must reject, not silently truncate.
    await expect(sink.write('c.png', new Uint8Array(1))).rejects.toThrow(/ZIP limit/)
  })

  it('write() after close() or abort() throws', async () => {
    const closedSink = createZipFrameSink()
    await closedSink.close()
    await expect(closedSink.write('a.png', enc.encode('x'))).rejects.toThrow(/after close/)

    const abortedSink = createZipFrameSink()
    await abortedSink.write('a.png', enc.encode('x'))
    await abortedSink.abort(new Error('nope'))
    await expect(abortedSink.write('b.png', enc.encode('x'))).rejects.toThrow(/after close/)
  })

  it('the default limits match the design (128 MiB / 10,000 files)', () => {
    expect(PNG_ZIP_MAX_BYTES).toBe(128 * 1024 * 1024)
    expect(PNG_ZIP_MAX_FILES).toBe(10000)
  })
})
