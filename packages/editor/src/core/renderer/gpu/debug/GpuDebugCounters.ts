/**
 * GpuDebugCounters — lightweight metrics store for decode/cache instrumentation.
 *
 * Phase 1 additions: droppedFrames, outstandingDecodes, decoderStateTransitions.
 *
 * Zero overhead when not imported. No React or store coupling.
 */

import type { DecoderState } from '../../../media/video/VideoDecoderManager'

const MAX_LATENCY_SAMPLES = 256

export interface CounterSnapshot {
  activeVideoFrames: number
  closedVideoFrames: number
  cacheSize: number
  decoderCount: number
  pendingDecodeRequests: number
  outstandingDecodes: number
  droppedFrames: number
  cacheHits: number
  cacheMisses: number
  cacheHitRatio: number
  avgDecodeLatencyMs: number
  avgFrameUploadMs: number
  decodeLatencySampleCount: number
  frameUploadSampleCount: number
  /** Per-state transition counts since last reset. */
  decoderStateTransitions: Partial<Record<DecoderState, number>>
}

export const GpuDebugCounters = {
  activeVideoFrames: 0,
  closedVideoFrames: 0,
  cacheSize: 0,
  decoderCount: 0,
  pendingDecodeRequests: 0,
  /** Current number of in-flight decode requests across all providers. */
  outstandingDecodes: 0,
  /** Total frames dropped due to decode failure (not seek/drain cancellation). */
  droppedFrames: 0,
  cacheHits: 0,
  cacheMisses: 0,
  decodeLatencyMs: [] as number[],
  frameUploadTimingsMs: [] as number[],
  decoderStateTransitions: {} as Partial<Record<DecoderState, number>>,

  reset(): void {
    this.activeVideoFrames = 0
    this.closedVideoFrames = 0
    this.cacheSize = 0
    this.decoderCount = 0
    this.pendingDecodeRequests = 0
    this.outstandingDecodes = 0
    this.droppedFrames = 0
    this.cacheHits = 0
    this.cacheMisses = 0
    this.decodeLatencyMs = []
    this.frameUploadTimingsMs = []
    this.decoderStateTransitions = {}
  },

  /** Increment dropped frame counter. Called on non-cancellation decode failures. */
  incDropped(): void {
    this.droppedFrames++
  },

  /** Record a decoder state transition for diagnostics. */
  recordDecoderTransition(state: DecoderState): void {
    this.decoderStateTransitions[state] = (this.decoderStateTransitions[state] ?? 0) + 1
  },

  recordDecodeLatency(ms: number): void {
    this.decodeLatencyMs.push(ms)
    if (this.decodeLatencyMs.length > MAX_LATENCY_SAMPLES) {
      this.decodeLatencyMs.shift()
    }
  },

  recordFrameUpload(ms: number): void {
    this.frameUploadTimingsMs.push(ms)
    if (this.frameUploadTimingsMs.length > MAX_LATENCY_SAMPLES) {
      this.frameUploadTimingsMs.shift()
    }
  },

  snapshot(): CounterSnapshot {
    const totalLookups = this.cacheHits + this.cacheMisses
    return {
      activeVideoFrames: this.activeVideoFrames,
      closedVideoFrames: this.closedVideoFrames,
      cacheSize: this.cacheSize,
      decoderCount: this.decoderCount,
      pendingDecodeRequests: this.pendingDecodeRequests,
      outstandingDecodes: this.outstandingDecodes,
      droppedFrames: this.droppedFrames,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRatio: totalLookups > 0 ? this.cacheHits / totalLookups : 0,
      avgDecodeLatencyMs: average(this.decodeLatencyMs),
      avgFrameUploadMs: average(this.frameUploadTimingsMs),
      decodeLatencySampleCount: this.decodeLatencyMs.length,
      frameUploadSampleCount: this.frameUploadTimingsMs.length,
      decoderStateTransitions: { ...this.decoderStateTransitions },
    }
  },
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}
