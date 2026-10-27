/**
 * Audio analysis (PV-P10b): turn mono PCM into beats, onsets, a tempo, silent
 * stretches and per-frame loudness/band envelopes, all quantised to project
 * frames.
 *
 * Deterministic, dependency-free (three RBJ biquad band-passes, spectral flux
 * onset detection and an onset-envelope autocorrelation for tempo — no FFT
 * library), and DOM-free so it runs in Node, a Web Worker or the main thread
 * alike. See PLAN-EDITOR-PRO-UX.md "Audio analysis (in the browser, no
 * dependencies)" for the design this implements, and the ticket
 * (TICKET-PV-P10b-1.md) for the exact algorithm this file must not deviate
 * from without recording why.
 */

export const ANALYSIS_VERSION = 1

export interface AudioAnalysisOptions {
  /** Tempo search range. Defaults 60 and 180. */
  minBpm?: number
  maxBpm?: number
  /** Shortest silence reported, seconds. Default 0.3. */
  minSilenceSec?: number
}

export interface AudioAnalysis {
  version: number
  sampleRate: number
  fps: number
  /** ceil(samples × fps / sampleRate). */
  durationFrames: number
  /** One decimal. Absent when no steady tempo. */
  bpm?: number
  /** Normalised autocorrelation at the chosen period, 0..1; 0 when there is no tempo. */
  tempoConfidence: number
  /** Frames, ascending, unique. */
  beats: number[]
  onsets: number[]
  /** `[start, end)` frames. */
  silences: Array<[number, number]>
  /** Per frame, 0..1 (−60 dBFS → 0, 0 dBFS → 1). */
  loudness: Float32Array
  bands: { low: Float32Array; mid: Float32Array; high: Float32Array }
}

const FEATURE_RATE = 100 // feature hops per second (≈10 ms)
const BAND_HZ = { low: 100, mid: 1000, high: 6000 } as const // RBJ band-pass centres
const BAND_Q = 0.707
const LOG_COMPRESSION = 1000
const ONSET = { preMax: 3, postMax: 3, preAvg: 10, postAvg: 7, delta: 0.07, minGap: 5 } // in hops
const TEMPO = { minBpm: 60, maxBpm: 180, priorBpm: 120, priorOctaves: 1, minConfidence: 0.1, minOnsets: 4 }
const BEAT = { snapFraction: 0.1, snapMinStrength: 0.1 }
const LOUDNESS_FLOOR_DB = -60
const SILENCE = { belowReferenceDb: 30, floorDb: -60, referencePercentile: 0.95, minSec: 0.3 }

type BandKey = 'low' | 'mid' | 'high'
const BAND_KEYS: readonly BandKey[] = ['low', 'mid', 'high']

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

/** `argmax` over an inclusive index range; ties break toward the smaller index. */
function argmaxIndex(values: ArrayLike<number>, lo: number, hi: number): number {
  let best = lo
  let bestValue = values[lo]
  for (let i = lo + 1; i <= hi; i++) {
    if (values[i] > bestValue) {
      bestValue = values[i]
      best = i
    }
  }
  return best
}

function mean(values: ArrayLike<number>, lo: number, hi: number): number {
  let sum = 0
  let count = 0
  for (let i = lo; i <= hi; i++) {
    sum += values[i]
    count++
  }
  return count > 0 ? sum / count : 0
}

function dB(sum: number, count: number): number {
  return count > 0 ? 10 * Math.log10(sum / count + 1e-12) : -120
}

function emptyAnalysis(sampleRate: number, fps: number): AudioAnalysis {
  return {
    version: ANALYSIS_VERSION,
    sampleRate,
    fps,
    durationFrames: 0,
    tempoConfidence: 0,
    beats: [],
    onsets: [],
    silences: [],
    loudness: new Float32Array(0),
    bands: { low: new Float32Array(0), mid: new Float32Array(0), high: new Float32Array(0) },
  }
}

/** Grow a typed array to hold at least `need` elements (doubling), keeping its contents. */
function grown(a: Float64Array, need: number): Float64Array {
  if (need <= a.length) return a
  const next = new Float64Array(Math.max(need, a.length * 2, 1024))
  next.set(a)
  return next
}

/**
 * Incremental front end of `analyzePcm`: feed mono PCM in chunks with `push`,
 * then `finish`. Only step 1 (the band-pass filters and the per-hop / per-frame
 * energy accumulators) touches samples, and it is a single left-to-right pass,
 * so chunking is exact: the result is bit-identical to `analyzePcm` over the
 * concatenation. Memory is O(duration x 100 Hz), never O(samples), which is
 * what lets a multi-hour file be analysed from a stream (LM-P5).
 */
export class PcmAnalyzer {
  private readonly sampleRate: number
  private readonly fps: number
  private readonly options: AudioAnalysisOptions | undefined
  private readonly hop: number
  private n = 0
  private blockSq: [Float64Array, Float64Array, Float64Array]
  private frameSq: [Float64Array, Float64Array, Float64Array]
  private frameSqFull: Float64Array
  private frameCount: Float64Array
  private readonly c: Array<{ b0: number; b2: number; a1: number; a2: number }>
  private readonly st: Array<{ x1: number; x2: number; y1: number; y2: number }>

  constructor(sampleRate: number, fps: number, options?: AudioAnalysisOptions) {
    if (!Number.isFinite(sampleRate) || sampleRate < 8000) {
      throw new RangeError(`analyzePcm: sampleRate must be finite and >= 8000, got ${sampleRate}`)
    }
    if (!Number.isFinite(fps) || fps <= 0) {
      throw new RangeError(`analyzePcm: fps must be finite and > 0, got ${fps}`)
    }
    this.sampleRate = sampleRate
    this.fps = fps
    this.options = options
    this.hop = Math.max(1, Math.round(sampleRate / FEATURE_RATE))
    this.blockSq = [new Float64Array(1024), new Float64Array(1024), new Float64Array(1024)]
    this.frameSq = [new Float64Array(1024), new Float64Array(1024), new Float64Array(1024)]
    this.frameSqFull = new Float64Array(1024)
    this.frameCount = new Float64Array(1024)
    this.c = BAND_KEYS.map((b) => {
      const f0 = Math.min(BAND_HZ[b], 0.45 * sampleRate)
      const w0 = (2 * Math.PI * f0) / sampleRate
      const alpha = Math.sin(w0) / (2 * BAND_Q)
      const a0 = 1 + alpha
      return { b0: alpha / a0, b2: -alpha / a0, a1: (-2 * Math.cos(w0)) / a0, a2: (1 - alpha) / a0 }
    })
    this.st = BAND_KEYS.map(() => ({ x1: 0, x2: 0, y1: 0, y2: 0 }))
  }

  /** Samples consumed so far. */
  get sampleCount(): number {
    return this.n
  }

  push(chunk: Float32Array): void {
    const len = chunk.length
    if (len === 0) return
    const { sampleRate, fps, hop } = this
    const lastIndex = this.n + len - 1
    const needFrames = Math.floor((lastIndex * fps) / sampleRate) + 1
    const needBlocks = Math.floor(lastIndex / hop) + 1
    for (let b = 0; b < 3; b++) {
      this.blockSq[b] = grown(this.blockSq[b]!, needBlocks)
      this.frameSq[b] = grown(this.frameSq[b]!, needFrames)
    }
    this.frameSqFull = grown(this.frameSqFull, needFrames)
    this.frameCount = grown(this.frameCount, needFrames)
    const { blockSq, frameSq, frameSqFull, frameCount, c, st } = this
    for (let k = 0; k < len; k++) {
      const i = this.n + k
      const x = chunk[k]!
      const f = Math.floor((i * fps) / sampleRate)
      const blockIdx = Math.floor(i / hop)
      frameSqFull[f]! += x * x
      frameCount[f]! += 1
      for (let b = 0; b < 3; b++) {
        const cb = c[b]!
        const s = st[b]!
        const y = cb.b0 * x + cb.b2 * s.x2 - cb.a1 * s.y1 - cb.a2 * s.y2
        s.x2 = s.x1
        s.x1 = x
        s.y2 = s.y1
        s.y1 = y
        blockSq[b]![blockIdx]! += y * y
        frameSq[b]![f]! += y * y
      }
    }
    this.n += len
  }

  finish(): AudioAnalysis {
    const { sampleRate, fps, hop, n, options } = this
    if (n === 0) return emptyAnalysis(sampleRate, fps)
    const durationFrames = Math.ceil((n * fps) / sampleRate)
    const H = Math.ceil(n / hop)
    return finalizeAnalysis(
      sampleRate,
      fps,
      hop,
      n,
      {
        low: this.blockSq[0].subarray(0, H),
        mid: this.blockSq[1].subarray(0, H),
        high: this.blockSq[2].subarray(0, H),
      },
      {
        low: this.frameSq[0].subarray(0, durationFrames),
        mid: this.frameSq[1].subarray(0, durationFrames),
        high: this.frameSq[2].subarray(0, durationFrames),
      },
      this.frameSqFull.subarray(0, durationFrames),
      this.frameCount.subarray(0, durationFrames),
      options,
    )
  }
}

export function analyzePcm(
  mono: Float32Array,
  sampleRate: number,
  fps: number,
  options?: AudioAnalysisOptions,
): AudioAnalysis {
  const analyzer = new PcmAnalyzer(sampleRate, fps, options)
  analyzer.push(mono)
  return analyzer.finish()
}

/** Steps 2-7 of the analysis, from the accumulators `PcmAnalyzer.push` filled. */
function finalizeAnalysis(
  sampleRate: number,
  fps: number,
  hop: number,
  n: number,
  blockSq: Record<BandKey, Float64Array>,
  frameSq: Record<BandKey, Float64Array>,
  frameSqFull: Float64Array,
  frameCount: Float64Array,
  options: AudioAnalysisOptions | undefined,
): AudioAnalysis {
  const minBpm = options?.minBpm ?? TEMPO.minBpm
  const maxBpm = options?.maxBpm ?? TEMPO.maxBpm
  const minSilenceSec = options?.minSilenceSec ?? SILENCE.minSec
  const durationFrames = Math.ceil((n * fps) / sampleRate)
  const hopSec = hop / sampleRate
  const H = Math.ceil(n / hop)

  // --- 2. Per-frame envelopes and loudness ---
  const loudness = new Float32Array(durationFrames)
  const bands = {
    low: new Float32Array(durationFrames),
    mid: new Float32Array(durationFrames),
    high: new Float32Array(durationFrames),
  }
  for (let f = 0; f < durationFrames; f++) {
    loudness[f] = clamp((dB(frameSqFull[f], frameCount[f]) - LOUDNESS_FLOOR_DB) / -LOUDNESS_FLOOR_DB, 0, 1)
    for (const b of BAND_KEYS) {
      bands[b][f] = clamp((dB(frameSq[b][f], frameCount[f]) - LOUDNESS_FLOOR_DB) / -LOUDNESS_FLOOR_DB, 0, 1)
    }
  }

  // --- 3. Onset envelope over hops ---
  const E: Record<BandKey, Float64Array> = {
    low: new Float64Array(H),
    mid: new Float64Array(H),
    high: new Float64Array(H),
  }
  for (const b of BAND_KEYS) {
    const block = blockSq[b]
    const e = E[b]
    for (let h = 0; h < H; h++) {
      e[h] = (block[h] + (h + 1 < H ? block[h + 1] : 0)) / (2 * hop)
    }
  }
  const L: Record<BandKey, Float64Array> = {
    low: new Float64Array(H),
    mid: new Float64Array(H),
    high: new Float64Array(H),
  }
  for (const b of BAND_KEYS) {
    const e = E[b]
    let maxE = 0
    for (let h = 0; h < H; h++) if (e[h] > maxE) maxE = e[h]
    const l = L[b]
    if (maxE > 0) {
      for (let h = 0; h < H; h++) l[h] = Math.log(1 + (LOG_COMPRESSION * e[h]) / maxE)
    }
  }
  const O = new Float64Array(H)
  for (let h = 1; h < H; h++) {
    let sum = 0
    for (const b of BAND_KEYS) sum += Math.max(0, L[b][h] - L[b][h - 1])
    O[h] = sum
  }
  let maxO = 0
  for (let h = 0; h < H; h++) if (O[h] > maxO) maxO = O[h]
  if (maxO > 0) for (let h = 0; h < H; h++) O[h] /= maxO

  // --- 4. Onsets (peak picking) ---
  const hopTime = (h: number) => (h + 1) * hopSec
  const toFrame = (t: number) => clamp(Math.round(t * fps), 0, durationFrames - 1)

  const onsetHops: number[] = []
  let previousOnsetHop = -Infinity
  for (let h = 1; h < H; h++) {
    const preMaxLo = Math.max(0, h - ONSET.preMax)
    const postMaxHi = Math.min(H - 1, h + ONSET.postMax)
    const localMax = O[argmaxIndex(O, preMaxLo, postMaxHi)]
    if (O[h] < localMax) continue
    if (!(O[h] > O[h - 1])) continue
    const preAvgLo = Math.max(0, h - ONSET.preAvg)
    const postAvgHi = Math.min(H - 1, h + ONSET.postAvg)
    if (!(O[h] >= mean(O, preAvgLo, postAvgHi) + ONSET.delta)) continue
    if (h - previousOnsetHop < ONSET.minGap) continue
    onsetHops.push(h)
    previousOnsetHop = h
  }
  const onsetFrameSet = new Set<number>()
  for (const h of onsetHops) onsetFrameSet.add(toFrame(hopTime(h)))
  const onsets = Array.from(onsetFrameSet).sort((a, b) => a - b)

  // --- 5. Tempo ---
  const tauMin = Math.floor(60 / (maxBpm * hopSec))
  const tauMax = Math.ceil(60 / (minBpm * hopSec))
  const tau0 = 60 / (TEMPO.priorBpm * hopSec)

  let bpm: number | undefined
  let tempoConfidence = 0
  let period: number | undefined

  const noTempo = onsetHops.length < TEMPO.minOnsets || H < 2 * tauMax + 2
  if (!noTempo) {
    const meanO = mean(O, 0, H - 1)
    const D = new Float64Array(H)
    for (let h = 0; h < H; h++) D[h] = O[h] - meanO
    let R0 = 0
    for (let h = 0; h < H; h++) R0 += D[h] * D[h]
    R0 /= H

    const rCache = new Map<number, number>()
    const R = (tau: number): number => {
      if (tau < 0 || tau >= H) return 0
      const cached = rCache.get(tau)
      if (cached !== undefined) return cached
      const count = H - tau
      let sum = 0
      for (let h = 0; h < count; h++) sum += D[h] * D[h + tau]
      const value = count > 0 ? sum / count : 0
      rCache.set(tau, value)
      return value
    }

    if (R0 > 0) {
      let bestTau = tauMin
      let bestScore = -Infinity
      for (let tau = tauMin; tau <= tauMax; tau++) {
        const prior = Math.exp(-0.5 * ((Math.log2(tau / tau0) / TEMPO.priorOctaves) ** 2))
        const score = R(tau) * prior
        if (score > bestScore) {
          bestScore = score
          bestTau = tau
        }
      }
      const confidence = R(bestTau) / R0
      if (confidence >= TEMPO.minConfidence) {
        const a = R(bestTau - 1)
        const b = R(bestTau)
        const c = R(bestTau + 1)
        const den = a - 2 * b + c
        const delta = den < 0 ? clamp((0.5 * (a - c)) / den, -0.5, 0.5) : 0
        const p = bestTau + delta
        bpm = Math.round(600 / (p * hopSec)) / 10
        tempoConfidence = Math.min(1, confidence)
        period = p
      }
    }
  }

  // --- 6. Beats (only with a tempo) ---
  const beatFrameSet = new Set<number>()
  if (bpm !== undefined && period !== undefined) {
    const P = period
    const maxPhi = Math.floor(P)
    let bestPhi = 0
    let bestScore = -Infinity
    for (let phi = 0; phi <= maxPhi; phi++) {
      let score = 0
      for (let k = 0; ; k++) {
        const idx = Math.round(phi + k * P)
        if (idx >= H) break
        score += O[idx]
      }
      if (score > bestScore) {
        bestScore = score
        bestPhi = phi
      }
    }

    let p = bestPhi
    const takenHops: number[] = []
    while (Math.round(p) < H) {
      const lo = Math.max(0, Math.round(p - BEAT.snapFraction * P))
      const hi = Math.min(H - 1, Math.round(p + BEAT.snapFraction * P))
      const m = argmaxIndex(O, lo, hi)
      if (O[m] >= BEAT.snapMinStrength) {
        takenHops.push(m)
        p = m + P
      } else {
        takenHops.push(Math.round(p))
        p = p + P
      }
    }
    for (const h of takenHops) beatFrameSet.add(toFrame(hopTime(h)))
  }
  const beats = Array.from(beatFrameSet).sort((a, b) => a - b)

  // --- 7. Silences ---
  const dbs = new Float64Array(durationFrames)
  for (let f = 0; f < durationFrames; f++) dbs[f] = dB(frameSqFull[f], frameCount[f])
  const sortedDbs = Array.from(dbs).sort((a, b) => a - b)
  const reference = sortedDbs[Math.floor(SILENCE.referencePercentile * (durationFrames - 1))]
  const threshold = Math.max(reference - SILENCE.belowReferenceDb, SILENCE.floorDb)
  const minRun = Math.ceil(minSilenceSec * fps)

  const silences: Array<[number, number]> = []
  let runStart: number | null = null
  for (let f = 0; f < durationFrames; f++) {
    const below = dbs[f] < threshold
    if (below && runStart === null) {
      runStart = f
    } else if (!below && runStart !== null) {
      if (f - runStart >= minRun) silences.push([runStart, f])
      runStart = null
    }
  }
  if (runStart !== null && durationFrames - runStart >= minRun) silences.push([runStart, durationFrames])

  return {
    version: ANALYSIS_VERSION,
    sampleRate,
    fps,
    durationFrames,
    ...(bpm !== undefined ? { bpm } : {}),
    tempoConfidence,
    beats,
    onsets,
    silences,
    loudness,
    bands,
  }
}
