/**
 * createMediabunnyBackend — adapter from the real mediabunny npm package
 * to the DemuxerBackend interface consumed by VideoDecoderManager.
 *
 * mediabunny is NOT a required dependency of @elah/editor.
 * Consumers inject this backend via GpuRenderer options:
 *
 *   import * as mediabunny from 'mediabunny'
 *   import { createMediabunnyBackend } from '@elah/editor'
 *
 *   const renderer = new GpuRenderer({
 *     demuxerFactory: () => createMediabunnyBackend(mediabunny, { blobResolver }),
 *   })
 *
 * Real mediabunny API (v1.x):
 *   Input + BlobSource — construct with a Blob, not a URL
 *   input.getPrimaryVideoTrack()    → Promise<VideoTrack | null>
 *   videoTrack.getDecoderConfig()   → Promise<VideoDecoderConfig | null>
 *   new EncodedPacketSink(track)
 *   sink.getKeyPacket(seconds)      → Promise<EncodedPacket | null>
 *   sink.getNextPacket(packet)      → Promise<EncodedPacket | null>
 *   packet.toEncodedVideoChunk()    → EncodedVideoChunk
 *   packet.timestamp                → float seconds
 *
 * Timing bridge:
 *   VideoDecoderManager uses integer microseconds (µs) internally.
 *   mediabunny uses floating-point seconds.
 *   All conversions happen inside this file: µs / 1e6 → seconds.
 *
 * Architecture notes:
 *  - This file has zero imports from React, Zustand, or any store.
 *  - It imports only DemuxerBackend from the co-located interface file.
 *  - Worker-safe: no DOM access, no document/window references.
 *  - blobResolver defaults to fetch(src).blob() — works for blob:, http:, data:.
 *    Callers who retain the original File can pass it directly to avoid the
 *    fetch round-trip (see createPlaygroundDemuxerFactory).
 *
 * FUTURE (S10): Worker decode migration. DemuxerBackend is already worker-safe;
 *   move instantiation behind a MessagePort without changing this file's API.
 * FUTURE (S12): Hardware acceleration — pass hardwareAcceleration through opts.
 *
 * @see EVOLUTION.md § 7 Extension Seams S10, S12
 * @see IMPLEMENTATION_NOTES.md — why blobResolver exists
 */

import type { DemuxerBackend } from './MediabunnyDemuxer'

/**
 * Toggle in DevTools: `window.__DEMUX_DEBUG__ = true` to trace which branch
 * packets() takes (seek / contiguous / keyframe) and every packet timestamp it
 * yields. This is the decisive trace for diagnosing decode-stream gaps between
 * consecutive feed windows. Off by default.
 */
function _demuxTrace(msg: string, data?: Record<string, unknown>): void {
  if (
    typeof globalThis !== 'undefined' &&
    (globalThis as { __DEMUX_DEBUG__?: boolean }).__DEMUX_DEBUG__
  ) {
    if (data) {
      console.log(`[DEMUX-TRACE] ${msg}`, data)
    } else {
      console.log(`[DEMUX-TRACE] ${msg}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Structural interface — only the mediabunny subset used here is typed.
// The editor package never imports the real 'mediabunny' types so that
// consumers control whether and when the package is in their bundle.
// ---------------------------------------------------------------------------

interface MbEncodedPacket {
  /** Timestamp in floating-point seconds. */
  readonly timestamp: number
  toEncodedVideoChunk(): EncodedVideoChunk
}

interface MbVideoTrack {
  getDecoderConfig(): Promise<VideoDecoderConfig | null>
}

interface MbInput {
  getPrimaryVideoTrack(): Promise<MbVideoTrack | null>
  /** Present on mediabunny's Input but name may vary; dispose resources. */
  [key: string]: unknown
}

interface MbEncodedPacketSink {
  /** Seek to the nearest keyframe at or before `seconds`. */
  getKeyPacket(seconds: number): Promise<MbEncodedPacket | null>
  /** Return the next packet after `prev`. */
  getNextPacket(prev: MbEncodedPacket): Promise<MbEncodedPacket | null>
}

/**
 * Structural shape of the mediabunny module used by this adapter.
 * Only the subset consumed here is declared.
 */
export interface MediabunnyModule {
  Input: new (opts: { formats: unknown[]; source: unknown }) => MbInput
  BlobSource: new (blob: Blob) => unknown
  EncodedPacketSink: new (track: MbVideoTrack) => MbEncodedPacketSink
  /** All container formats. Pass to Input({ formats }) for maximum compatibility. */
  ALL_FORMATS: unknown[]
  [key: string]: unknown
}

export interface CreateMediabunnyBackendOpts {
  /**
   * Resolve a clip's src (object URL, blob:, or http: URL) to a Blob.
   * Defaults to fetch(src).then(r => r.blob()).
   *
   * Override this in the playground to return the original File directly,
   * avoiding a fetch round-trip for freshly-imported local files.
   */
  blobResolver?: (src: string) => Promise<Blob>
}

/**
 * Returns true when the passed object looks like a compatible mediabunny module.
 * Use before calling createMediabunnyBackend for early validation.
 */
export function isMediabunnyCompatible(module: unknown): module is MediabunnyModule {
  if (!module || typeof module !== 'object') return false
  const m = module as Record<string, unknown>
  return (
    typeof m['Input'] === 'function' &&
    typeof m['BlobSource'] === 'function' &&
    typeof m['EncodedPacketSink'] === 'function' &&
    Array.isArray(m['ALL_FORMATS'])
  )
}

/**
 * Wrap a mediabunny module into a fresh DemuxerBackend.
 *
 * Call this inside a DemuxerFactory — it creates a stateful backend per clip:
 *
 * ```ts
 * const factory: DemuxerFactory = () =>
 *   createMediabunnyBackend(mediabunny, { blobResolver })
 *
 * const renderer = new GpuRenderer({ demuxerFactory: factory })
 * ```
 *
 * @param mb  The mediabunny module (import * as mb from 'mediabunny').
 * @param opts Optional configuration including blobResolver.
 * @throws {Error} At open() time if the video track has an unknown codec.
 */
export function createMediabunnyBackend(
  mb: MediabunnyModule,
  opts: CreateMediabunnyBackendOpts = {},
): DemuxerBackend {
  _assertMediabunnyApi(mb)

  const resolve = opts.blobResolver ?? defaultBlobResolver

  // State populated by open()
  let _sink: MbEncodedPacketSink | null = null
  let _config: VideoDecoderConfig | null = null
  // Cached packet from seekToKeyframe so the next packets() call starts there.
  let _seekPacket: MbEncodedPacket | null = null
  // Packet to continue from on the next contiguous packets() call.
  // Populated at the end of each packets() iteration.
  let _nextPacket: MbEncodedPacket | null = null
  let _lastEndSec: number | null = null
  let _disposed = false

  return {
    async open(src: string): Promise<void> {
      if (_disposed) throw new Error('createMediabunnyBackend: already disposed')

      const blob = await resolve(src)

      const input = new mb.Input({
        formats: mb.ALL_FORMATS,
        source: new mb.BlobSource(blob),
      })

      const track = await input.getPrimaryVideoTrack()
      if (!track) {
        throw new Error(
          `createMediabunnyBackend: no video track found in "${src}". ` +
            'Ensure the file is a supported video format (MP4, WebM, MKV, MOV).',
        )
      }

      const config = await track.getDecoderConfig()
      if (!config) {
        throw new Error(
          `createMediabunnyBackend: video track codec is not supported by this browser in "${src}". ` +
            'Try a file encoded with H.264 (AVC) or VP8/VP9.',
        )
      }

      _config = config
      _sink = new mb.EncodedPacketSink(track)
    },

    getConfig(): VideoDecoderConfig {
      _assertOpen(_sink, _config)
      return _config!
    },

    /**
     * Async-generator that yields EncodedVideoChunks for the time range.
     *
     * timeRange is in microseconds (VideoDecoderManager convention).
     * Internally converts to floating-point seconds (mediabunny convention).
     *
     * Seeks to the nearest keyframe at or before startUs, then yields all
     * packets up to (but not including) endUs. A cached _seekPacket from a
     * prior seekToKeyframe() call is used as the start point to avoid a
     * redundant seek.
     *
     * Forward-progress invariant for the contiguous-continuation branch:
     *   When a buffered _nextPacket exists for a contiguous request, this
     *   generator MUST yield at least one packet for any non-EOF call, even
     *   when the buffered packet's timestamp already exceeds endSec.
     *   Without this, source streams whose packet cadence is sparser than
     *   the manager's fps (e.g. a 10 fps source rendered at 30 fps) would
     *   produce zero packets for a contiguous decode, leaving the WebCodecs
     *   decoder with nothing to flush. The manager would then have no real
     *   output frame to return and texImage2D would fail downstream
     *   ("Overload resolution failed"). Yielding the buffered packet keeps
     *   the decoder fed; the manager picks the nearest-timestamp output.
     */
    async *packets([startUs, endUs]: [number, number]): AsyncIterable<EncodedVideoChunk> {
      _assertOpen(_sink, _config)

      const startSec = startUs / 1e6
      const endSec = endUs / 1e6

      let pkt: MbEncodedPacket | null
      // When set, the loop yields the first packet unconditionally to
      // preserve the forward-progress invariant documented above.
      let yieldFirstUnconditionally = false

      let branch: 'seek' | 'contiguous' | 'keyframe'
      if (_seekPacket !== null) {
        // Explicit seek — use the cached keyframe packet.
        pkt = _seekPacket
        _seekPacket = null
        _nextPacket = null
        branch = 'seek'
      } else if (
        _nextPacket !== null &&
        _lastEndSec !== null &&
        Math.abs(startSec - _lastEndSec) < 1e-9
      ) {
        // Contiguous continuation — start from where the last iteration ended.
        pkt = _nextPacket
        _nextPacket = null
        yieldFirstUnconditionally = true
        branch = 'contiguous'
      } else {
        // Non-contiguous and no seek packet: seek to nearest keyframe.
        pkt = await _sink!.getKeyPacket(startSec)
        _nextPacket = null
        branch = 'keyframe'
      }

      _demuxTrace('packets() start', {
        branch,
        startSec,
        endSec,
        lastEndSec: _lastEndSec,
        contiguityGap: _lastEndSec !== null ? startSec - _lastEndSec : null,
        firstPktSec: pkt ? pkt.timestamp : null,
      })

      const yielded: number[] = []
      while (pkt !== null && (yieldFirstUnconditionally || pkt.timestamp < endSec)) {
        if (_disposed) break
        yielded.push(pkt.timestamp)
        yield pkt.toEncodedVideoChunk()
        yieldFirstUnconditionally = false
        pkt = await _sink!.getNextPacket(pkt)
      }

      _demuxTrace('packets() done', {
        branch,
        yieldedCount: yielded.length,
        yieldedSec: yielded,
        nextPktSec: pkt ? pkt.timestamp : null,
      })

      // Store the packet that follows the last yielded one for the next contiguous call.
      _nextPacket = pkt
      _lastEndSec = endSec
    },

    /**
     * Pre-seek to the keyframe at timeUs so the next packets() call begins
     * from the correct position without an additional seek round-trip.
     *
     * timeUs is in microseconds; converted to seconds for mediabunny.
     */
    async seekToKeyframe(timeUs: number): Promise<void> {
      _assertOpen(_sink, _config)
      const timeSec = timeUs / 1e6
      _seekPacket = await _sink!.getKeyPacket(timeSec)
      _nextPacket = null
      _lastEndSec = null
    },

    dispose(): void {
      _disposed = true
      _sink = null
      _config = null
      _seekPacket = null
      _nextPacket = null
      _lastEndSec = null
      // mediabunny Input does not expose a public dispose/close method; the
      // BlobSource + Input are garbage-collected naturally. If a future
      // mediabunny version adds input.dispose(), call it here.
    },
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

const defaultBlobResolver: (src: string) => Promise<Blob> = (src) =>
  fetch(src).then((r) => {
    if (!r.ok) {
      throw new Error(
        `createMediabunnyBackend: failed to fetch "${src}" (${r.status} ${r.statusText})`,
      )
    }
    return r.blob()
  })

function _assertOpen(sink: MbEncodedPacketSink | null, config: VideoDecoderConfig | null): void {
  if (!sink || !config) {
    throw new Error('createMediabunnyBackend: backend not open — call open(src) first')
  }
}

function _assertMediabunnyApi(m: MediabunnyModule): void {
  if (!isMediabunnyCompatible(m)) {
    throw new Error(
      [
        'createMediabunnyBackend: the mediabunny module does not expose the expected API.',
        '',
        'Required exports: Input, BlobSource, EncodedPacketSink, ALL_FORMATS.',
        '',
        'Possible causes:',
        '  1. mediabunny is not installed. Run: npm install mediabunny',
        '  2. Incompatible version. This adapter targets mediabunny v1.x.',
        '  3. Wrong import. Use: import * as mediabunny from "mediabunny"',
        '',
        'Usage:',
        '  import * as mediabunny from "mediabunny"',
        '  import { createMediabunnyBackend } from "@elah/editor"',
        '  new GpuRenderer({ demuxerFactory: () => createMediabunnyBackend(mediabunny) })',
        '',
        'See: apps/playground/src/createPlaygroundDemuxerFactory.ts for a full example.',
      ].join('\n'),
    )
  }
}
