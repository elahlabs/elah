/**
 * Per-clip audio settings (`Clip.audio`): mute, boost, fades and Enhance.
 *
 * Everything here is pure. `clipAudioGain` is the one envelope both the
 * preview scene (`resolveTimeline`) and the export mix (`gainAutomation`)
 * multiply into a clip's volume, so what you hear is what you export.
 * `enhancePlan` is the one description of the Enhance chain that
 * `media/audio/enhanceChain.ts` turns into Web Audio nodes for both the live
 * `AudioContext` and the export `OfflineAudioContext`.
 *
 * Only audio clips and video clips carrying their own sound use these; every
 * other clip type reads as "no settings", which is also what every document
 * written before `Clip.audio` existed has.
 */

import type { Clip, ClipAudio, ClipAudioEnhance } from '../types'

/** Highest boost the inspector offers, in dB. */
export const MAX_BOOST_DB = 12
/** Longest fade, in seconds. A fade is also capped to half the clip. */
export const MAX_FADE_SEC = 10
/** What switching Enhance on starts from. */
export const DEFAULT_ENHANCE: ClipAudioEnhance = { noise: 0.5, voice: 0.5 }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Linear gain for a level in decibels. */
export function dbGain(db: number): number {
  return 10 ** (db / 20)
}

/** Whether `clip`'s type can carry `Clip.audio` at all. */
function carriesAudioSettings(clip: Pick<Clip, 'type'>): boolean {
  return clip.type === 'audio' || clip.type === 'video'
}

/**
 * A stored `audio` value made safe: unknown keys dropped, numbers clamped, an
 * Enhance with nothing switched on dropped, and `undefined` when nothing is
 * left (so an untouched clip stays byte-identical to one written before).
 */
export function readClipAudio(raw: unknown, type: Clip['type']): ClipAudio | undefined {
  if (type !== 'audio' && type !== 'video') return undefined
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: ClipAudio = {}
  if (r.muted === true) out.muted = true
  if (finite(r.boostDb) && r.boostDb > 0) out.boostDb = clamp(r.boostDb, 0, MAX_BOOST_DB)
  if (finite(r.fadeInSec) && r.fadeInSec > 0) out.fadeInSec = clamp(r.fadeInSec, 0, MAX_FADE_SEC)
  if (finite(r.fadeOutSec) && r.fadeOutSec > 0) out.fadeOutSec = clamp(r.fadeOutSec, 0, MAX_FADE_SEC)
  const e = r.enhance as Record<string, unknown> | undefined
  if (e && typeof e === 'object') {
    const noise = finite(e.noise) ? clamp(e.noise, 0, 1) : 0
    const voice = finite(e.voice) ? clamp(e.voice, 0, 1) : 0
    if (noise > 0 || voice > 0) out.enhance = { noise, voice }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Fade lengths in timeline frames, each capped to half the clip so the two never overlap. */
export function fadeFrames(clip: Pick<Clip, 'durationFrames' | 'audio'>, fps: number): { fadeIn: number; fadeOut: number } {
  const room = Math.floor(clip.durationFrames / 2)
  const frames = (sec: number | undefined) => (finite(sec) && sec > 0 ? Math.min(room, Math.round(sec * fps)) : 0)
  return { fadeIn: frames(clip.audio?.fadeInSec), fadeOut: frames(clip.audio?.fadeOutSec) }
}

/** True when the envelope changes over the clip (a fade), so it has to be sampled per frame. */
export function hasAudioEnvelopeShape(clip: Pick<Clip, 'type' | 'durationFrames' | 'audio'>, fps: number): boolean {
  if (!carriesAudioSettings(clip) || clip.audio?.muted) return false
  const { fadeIn, fadeOut } = fadeFrames(clip, fps)
  return fadeIn > 0 || fadeOut > 0
}

/**
 * The clip's own audio multiplier at clip-local `localFrame`: 0 when muted,
 * else boost × fade-in × fade-out. A fade-in runs linearly from silence on
 * frame 0 to full level `fadeIn` frames later; a fade-out mirrors it, silent
 * on the clip's last frame. 1 for a clip with no settings.
 */
export function clipAudioGain(clip: Pick<Clip, 'type' | 'durationFrames' | 'audio'>, localFrame: number, fps: number): number {
  const a = clip.audio
  if (!a || !carriesAudioSettings(clip)) return 1
  if (a.muted) return 0
  let g = a.boostDb ? dbGain(clamp(a.boostDb, 0, MAX_BOOST_DB)) : 1
  const { fadeIn, fadeOut } = fadeFrames(clip, fps)
  if (fadeIn > 0 && localFrame < fadeIn) g *= clamp(localFrame / fadeIn, 0, 1)
  const last = clip.durationFrames - 1
  if (fadeOut > 0 && localFrame > last - fadeOut) g *= clamp((last - localFrame) / fadeOut, 0, 1)
  return g
}

/** The clip's Enhance when it does anything, else undefined. */
export function activeEnhance(clip: Pick<Clip, 'type' | 'audio'>): ClipAudioEnhance | undefined {
  if (!carriesAudioSettings(clip)) return undefined
  const e = clip.audio?.enhance
  if (!e) return undefined
  return e.noise > 0 || e.voice > 0 ? e : undefined
}

/** A short key that changes whenever the Enhance chain would be built differently. */
export function enhanceSignature(e: ClipAudioEnhance | undefined): string {
  if (!e || (e.noise <= 0 && e.voice <= 0)) return ''
  return `${e.noise.toFixed(3)}:${e.voice.toFixed(3)}`
}

// ── The Enhance chain ─────────────────────────────────────────────────────

export type EnhanceStage =
  | { kind: 'biquad'; type: BiquadFilterType; frequency: number; q: number; gainDb: number }
  | { kind: 'denoise'; amount: number }
  | { kind: 'compressor'; threshold: number; knee: number; ratio: number; attack: number; release: number }
  | { kind: 'gain'; value: number }

/**
 * The Enhance chain for `e`, in signal order. Empty when Enhance is off.
 *
 *   Noise reduction  rumble high-pass, then the spectral denoiser
 *                    (`denoiseWorklet.ts`) at `noise` strength
 *   Voice clarity    less mud (250 Hz), more presence (3 kHz), a little less
 *                    sibilance (7 kHz), some air (10 kHz), gentle compression
 *                    and make-up gain, all scaled by `voice`
 */
export function enhancePlan(e: ClipAudioEnhance | undefined): EnhanceStage[] {
  if (!e) return []
  const noise = clamp(e.noise, 0, 1)
  const voice = clamp(e.voice, 0, 1)
  if (noise <= 0 && voice <= 0) return []
  const plan: EnhanceStage[] = [{ kind: 'biquad', type: 'highpass', frequency: 80, q: Math.SQRT1_2, gainDb: 0 }]
  if (noise > 0) plan.push({ kind: 'denoise', amount: noise })
  if (voice > 0) {
    plan.push(
      { kind: 'biquad', type: 'peaking', frequency: 250, q: 1, gainDb: -3 * voice },
      { kind: 'biquad', type: 'peaking', frequency: 3000, q: 0.8, gainDb: 5 * voice },
      { kind: 'biquad', type: 'peaking', frequency: 7000, q: 3, gainDb: -2 * voice },
      { kind: 'biquad', type: 'highshelf', frequency: 10000, q: Math.SQRT1_2, gainDb: 2 * voice },
      { kind: 'compressor', threshold: -20, knee: 12, ratio: 1 + 3 * voice, attack: 0.004, release: 0.2 },
      { kind: 'gain', value: dbGain(4 * voice) },
    )
  }
  return plan
}
