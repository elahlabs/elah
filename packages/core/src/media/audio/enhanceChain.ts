/**
 * Builds a clip's Enhance chain (`enhancePlan`, audio/clipAudio.ts) as Web
 * Audio nodes. The preview player and the export mix both call this, so the
 * two hear the same processing.
 *
 *   source → [chain.input … chain.output] → clip gain → …
 *
 * The chain sits BEFORE the clip's gain, so fades and volume shape the
 * processed sound and the compressor never undoes a fade.
 */

import type { ClipAudioEnhance } from '../../types'
import { enhancePlan } from '../../audio/clipAudio'
import { DENOISE_LATENCY_SAMPLES, DENOISE_PROCESSOR_NAME } from './denoiseConstants'

export interface EnhanceChain {
  input: AudioNode
  output: AudioNode
  nodes: AudioNode[]
  /** Seconds the chain delays its input (the denoiser's STFT), 0 without it. */
  latencySec: number
}

/**
 * The chain for `enhance`, or null when Enhance is off. `denoiseReady` is
 * `ensureDenoiseWorklet(ctx)`'s answer; without it the denoise stage is left
 * out and the rest still runs.
 */
export function buildEnhanceChain(
  ctx: BaseAudioContext,
  enhance: ClipAudioEnhance | undefined,
  denoiseReady: boolean,
): EnhanceChain | null {
  const plan = enhancePlan(enhance)
  if (plan.length === 0) return null
  const nodes: AudioNode[] = []
  let latencySec = 0
  for (const stage of plan) {
    switch (stage.kind) {
      case 'biquad': {
        const f = ctx.createBiquadFilter()
        f.type = stage.type
        f.frequency.value = stage.frequency
        f.Q.value = stage.q
        f.gain.value = stage.gainDb
        nodes.push(f)
        break
      }
      case 'denoise': {
        if (!denoiseReady || typeof AudioWorkletNode === 'undefined') break
        nodes.push(
          new AudioWorkletNode(ctx, DENOISE_PROCESSOR_NAME, {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            processorOptions: { amount: stage.amount },
          }),
        )
        latencySec = DENOISE_LATENCY_SAMPLES / ctx.sampleRate
        break
      }
      case 'compressor': {
        const c = ctx.createDynamicsCompressor()
        c.threshold.value = stage.threshold
        c.knee.value = stage.knee
        c.ratio.value = stage.ratio
        c.attack.value = stage.attack
        c.release.value = stage.release
        nodes.push(c)
        break
      }
      case 'gain': {
        const g = ctx.createGain()
        g.gain.value = stage.value
        nodes.push(g)
        break
      }
    }
  }
  for (let i = 0; i + 1 < nodes.length; i++) nodes[i]!.connect(nodes[i + 1]!)
  return { input: nodes[0]!, output: nodes[nodes.length - 1]!, nodes, latencySec }
}

/** Disconnect every node of a chain; safe to call twice. */
export function disconnectEnhanceChain(chain: EnhanceChain | null | undefined): void {
  if (!chain) return
  for (const n of chain.nodes) {
    try {
      n.disconnect()
    } catch {
      // Already disconnected.
    }
  }
}

/**
 * Lead-in that cancels a chain's latency when a source is scheduled with
 * `start(when, offset, duration)` at playback rate `rate`: start `lead`
 * seconds early and `lead * rate` source seconds earlier, so the processed
 * sound lands on the timeline where the dry sound would. Limited by how early
 * the context can start (`when`) and how much source precedes `offset`.
 */
export function latencyLead(latencySec: number, when: number, offset: number, rate: number): number {
  if (latencySec <= 0) return 0
  return Math.max(0, Math.min(latencySec, when, rate > 0 ? offset / rate : 0))
}
