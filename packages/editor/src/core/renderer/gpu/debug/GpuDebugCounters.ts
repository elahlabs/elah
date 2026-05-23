/**
 * GpuDebugCounters — lightweight metrics store for decode/cache instrumentation.
 *
 * Zero overhead when not imported. No React or store coupling.
 */

const MAX_LATENCY_SAMPLES = 256

export interface CounterSnapshot {
  activeVideoFrames: number
  closedVideoFrames: number
  cacheSize: number
  decoderCount: number
  pendingDecodeRequests: number
  cacheHits: number
  cacheMisses: number
  cacheHitRatio: number
  avgDecodeLatencyMs: number
  avgFrameUploadMs: number
  decodeLatencySampleCount: number
  frameUploadSampleCount: number
}

export const GpuDebugCounters = {
  activeVideoFrames: 0,
  closedVideoFrames: 0,
  cacheSize: 0,
  decoderCount: 0,
  pendingDecodeRequests: 0,
  cacheHits: 0,
  cacheMisses: 0,
  decodeLatencyMs: [] as number[],
  frameUploadTimingsMs: [] as number[],

  reset(): void {
    this.activeVideoFrames = 0
    this.closedVideoFrames = 0
    this.cacheSize = 0
    this.decoderCount = 0
    this.pendingDecodeRequests = 0
    this.cacheHits = 0
    this.cacheMisses = 0
    this.decodeLatencyMs = []
    this.frameUploadTimingsMs = []
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
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRatio: totalLookups > 0 ? this.cacheHits / totalLookups : 0,
      avgDecodeLatencyMs: average(this.decodeLatencyMs),
      avgFrameUploadMs: average(this.frameUploadTimingsMs),
      decodeLatencySampleCount: this.decodeLatencyMs.length,
      frameUploadSampleCount: this.frameUploadTimingsMs.length,
    }
  },
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}
