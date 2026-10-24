import { describe, expect, it, vi } from 'vitest'
import {
  AUDIO_RENDER_QUANTUM,
  planAudioSlices,
  renderInSlices,
  type SliceableOfflineContext,
} from '../audioMix'

/**
 * REN-6 stage 1. A fake offline context renders a deterministic signal one
 * render quantum at a time and honours suspend()/resume() the way the spec
 * does (pauses before the quantum at `time`, resolves the suspend promise, and
 * continues once resume() is called). The sliced render must equal the
 * unsliced one sample for sample (tolerance 0: suspend does not touch audio).
 */
const SR = 44100
const signal = (i: number) => Math.sin(i * 0.01) * 0.5 + (i % 7) * 0.01

class FakeCtx implements SliceableOfflineContext<Float32Array> {
  suspendTimes: number[] = []
  resumes = 0
  suspend?: (time: number) => Promise<void>
  resume?: () => Promise<void>
  private handlers = new Map<number, () => void>()
  private resolveResume: (() => void) | null = null

  constructor(public length: number, public sampleRate = SR, withSuspend = true) {
    if (withSuspend) {
      this.suspend = (time: number): Promise<void> => {
        const frame = Math.round(time * this.sampleRate)
        if (frame % AUDIO_RENDER_QUANTUM !== 0) throw new Error('suspend time not on a render quantum')
        if (this.handlers.has(frame)) throw new Error('duplicate suspend')
        this.suspendTimes.push(time)
        return new Promise<void>((res) => this.handlers.set(frame, res))
      }
      this.resume = (): Promise<void> => {
        this.resumes++
        this.resolveResume?.()
        return Promise.resolve()
      }
    }
  }

  async startRendering(): Promise<Float32Array> {
    const out = new Float32Array(this.length)
    for (let start = 0; start < this.length; start += AUDIO_RENDER_QUANTUM) {
      const h = this.handlers.get(start)
      if (h) {
        await new Promise<void>((resume) => {
          this.resolveResume = resume
          h()
        })
      }
      const end = Math.min(this.length, start + AUDIO_RENDER_QUANTUM)
      for (let i = start; i < end; i++) out[i] = signal(i)
    }
    return out
  }
}

describe('planAudioSlices', () => {
  it('is empty for a render shorter than one slice', () => {
    expect(planAudioSlices(SR * 3, SR, 5)).toEqual([])
  })

  it('returns increasing, quantum-aligned points strictly inside the render', () => {
    const length = SR * 23 + 77
    const points = planAudioSlices(length, SR, 5)
    expect(points.length).toBe(4)
    let prev = 0
    for (const t of points) {
      const frame = Math.round(t * SR)
      expect(frame % AUDIO_RENDER_QUANTUM).toBe(0)
      expect(frame).toBeGreaterThan(prev)
      expect(frame).toBeLessThan(length)
      prev = frame
    }
  })

  it('never emits a point at the very end', () => {
    const step = Math.round((5 * SR) / AUDIO_RENDER_QUANTUM) * AUDIO_RENDER_QUANTUM
    expect(planAudioSlices(step, SR, 5)).toEqual([])
    expect(planAudioSlices(step + 1, SR, 5).length).toBe(1)
  })
})

describe('renderInSlices', () => {
  it('produces samples identical to an unsliced render, yielding once per slice', async () => {
    const length = SR * 17 + 301
    const plain = await new FakeCtx(length, SR, false).startRendering()
    const ctx = new FakeCtx(length)
    const yieldFn = vi.fn(async () => undefined)
    const sliced = await renderInSlices(ctx, { sliceSeconds: 2, yieldFn })
    expect(sliced.length).toBe(plain.length)
    let maxDiff = 0
    for (let i = 0; i < plain.length; i++) maxDiff = Math.max(maxDiff, Math.abs(sliced[i]! - plain[i]!))
    expect(maxDiff).toBe(0) // stated tolerance: exact
    expect(yieldFn).toHaveBeenCalledTimes(ctx.suspendTimes.length)
    expect(ctx.suspendTimes.length).toBeGreaterThanOrEqual(8)
    expect(ctx.resumes).toBe(ctx.suspendTimes.length)
  })

  it('renders in one go when the context cannot suspend', async () => {
    const yieldFn = vi.fn(async () => undefined)
    const out = await renderInSlices(new FakeCtx(SR * 12, SR, false), { yieldFn })
    expect(out.length).toBe(SR * 12)
    expect(yieldFn).not.toHaveBeenCalled()
  })

  it('still renders when suspend throws (legacy callback form)', async () => {
    const ctx = new FakeCtx(SR * 12)
    ctx.suspend = () => {
      throw new TypeError('legacy')
    }
    const out = await renderInSlices(ctx, { sliceSeconds: 2 })
    expect(out.length).toBe(SR * 12)
  })
})
