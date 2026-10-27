import { describe, expect, it } from 'vitest'
import {
  DENOISE_HOP,
  DENOISE_LATENCY_SAMPLES,
  DENOISE_PROCESSOR_NAME,
  DENOISE_WORKLET_SOURCE,
} from '../denoiseWorklet'

const RATE = 48000

interface Processor {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
}

/** Evaluate the worklet module the way AudioWorkletGlobalScope would, with stubs. */
function loadProcessor(amount: number): Processor {
  const registered: Record<string, new (o: unknown) => Processor> = {}
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', DENOISE_WORKLET_SOURCE)(
    class {},
    (name: string, ctor: new (o: unknown) => Processor) => {
      registered[name] = ctor
    },
    RATE,
  )
  const Ctor = registered[DENOISE_PROCESSOR_NAME]
  if (!Ctor) throw new Error('processor not registered')
  return new Ctor({ processorOptions: { amount } })
}

/** Run `signal` (mono) through the processor block by block. */
function run(p: Processor, signal: Float32Array): Float32Array {
  const out = new Float32Array(signal.length)
  for (let i = 0; i + DENOISE_HOP <= signal.length; i += DENOISE_HOP) {
    const block = new Float32Array(DENOISE_HOP)
    p.process([[signal.subarray(i, i + DENOISE_HOP)]], [[block]])
    out.set(block, i)
  }
  return out
}

/** Deterministic white noise. */
function noise(n: number, level: number, seed = 1): Float32Array {
  let s = seed
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    out[i] = ((s / 2 ** 32) * 2 - 1) * level
  }
  return out
}

const rms = (x: Float32Array, from: number, to: number) => {
  let sum = 0
  for (let i = from; i < to; i++) sum += x[i]! * x[i]!
  return Math.sqrt(sum / (to - from))
}

describe('denoise worklet', () => {
  it('registers under its name', () => {
    expect(() => loadProcessor(0.5)).not.toThrow()
  })

  it('at amount 0 reconstructs its input exactly, DENOISE_LATENCY_SAMPLES late', () => {
    const input = noise(RATE / 2, 0.5)
    const out = run(loadProcessor(0), input)
    const processed = Math.floor(input.length / DENOISE_HOP) * DENOISE_HOP
    for (let i = DENOISE_LATENCY_SAMPLES; i < processed; i += 97) {
      expect(out[i]).toBeCloseTo(input[i - DENOISE_LATENCY_SAMPLES]!, 4)
    }
  })

  it('cuts steady noise in pauses while keeping a tone over it', () => {
    const n = RATE * 4
    const signal = noise(n, 0.02)
    // Silence (noise only) for 2 s, then a 440 Hz tone for 2 s.
    for (let i = RATE * 2; i < n; i++) signal[i]! += 0.3 * Math.sin((2 * Math.PI * 440 * i) / RATE)
    const out = run(loadProcessor(1), signal)
    const noiseIn = rms(signal, RATE, RATE * 2)
    const noiseOut = rms(out, RATE, RATE * 2)
    const toneIn = rms(signal, RATE * 3, RATE * 4)
    const toneOut = rms(out, RATE * 3, RATE * 4)
    // At least 10 dB less noise in the pause…
    expect(20 * Math.log10(noiseOut / noiseIn)).toBeLessThan(-10)
    // …and the tone within 1.5 dB.
    expect(Math.abs(20 * Math.log10(toneOut / toneIn))).toBeLessThan(1.5)
  })

  it('stops asking to run once its input is gone and the tail is flushed', () => {
    const p = loadProcessor(0.5)
    const block = () => [[new Float32Array(DENOISE_HOP)]]
    expect(p.process([[new Float32Array(DENOISE_HOP)]], block())).toBe(true)
    let alive = true
    let blocks = 0
    while (alive && blocks < 100) {
      alive = p.process([[]], block())
      blocks++
    }
    expect(alive).toBe(false)
    expect(blocks).toBeGreaterThan(DENOISE_LATENCY_SAMPLES / DENOISE_HOP)
  })
})
