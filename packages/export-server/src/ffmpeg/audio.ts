/**
 * Pure ffmpeg `-filter_complex` builder for the audio mix.
 *
 * The browser exporter mixes audio with `OfflineAudioContext` on the main
 * thread (see `packages/core/src/export/exportVideo.ts` `renderAudioMix`) and
 * hands the worker pre-mixed PCM — Web Audio does not exist in Node. This
 * module rebuilds the same schedule as an ffmpeg filter graph instead: one
 * `atrim` + `asetpts` + `aformat` + `volume` + `adelay` chain per segment,
 * summed with `amix`, then padded/trimmed to the export's exact duration.
 * Nothing here spawns a process or touches a filesystem — it is a function
 * from `AudioClipPlan[]` to a string, so the whole module is snapshot-testable
 * without ffmpeg installed.
 *
 * Deliberate divergence from the browser mix: `AudioClipPlan.volume` comes
 * from `Scene.audios[].volume`, which `resolveTimeline` already folds track
 * gain and mute into (`baseVolume * trackGain`). The browser's
 * `renderAudioMix` uses the raw `clip.volume` and only filters muted tracks,
 * so it silently ignores `track.volume`. The Scene value is the more correct
 * one and is what this module uses. Similarly, `project.masterVolume` is
 * applied only when the caller passes `options.masterVolume` explicitly —
 * the browser exporter never applies it either, and reading it from the
 * Project here would breach the Scene-only rule this package is built on.
 *
 * The `-ss` decision for audio is the opposite of the video decoder's: video
 * uses input `-ss` (see `decoder.ts`) because decoding a whole source from
 * byte zero per clip is ruinous and the mediabunny PTS index lets us recover
 * exactness. Audio decodes hundreds of times faster than realtime, so the
 * trim happens inside the filter graph (`atrim`) with no `-ss` at all — this
 * sidesteps AAC decoder priming/pre-roll, where an input seek can shift the
 * result by a few milliseconds. Never combine the two: input `-ss` rebases
 * PTS, which would silently invalidate the `atrim` window computed here.
 */

import type { AudioClipPlan, AudioMixSpec } from '../types'

export interface AudioMixOptions {
  fps: number
  totalFrames: number
  sampleRate: number
  channels: number
  /** Linear master gain. Default 1 — the browser exporter does not apply project.masterVolume. */
  masterVolume?: number
}

/**
 * The per-segment filter chain, without the amix/pad tail.
 *
 * `inputIndex` is the ffmpeg input index for this segment (input 0 is always
 * the rawvideo pipe, so the first audio segment is input 1). The chain's
 * output label is `a` followed by the zero-based segment position
 * (`inputIndex - 1`), matching the labels `buildAudioMix` wires into `amix`.
 *
 * Every number here is derived from frames; seconds only appear once the
 * value is interpolated into the string, so there is no double rounding
 * between this function and its caller.
 */
export function buildSegmentChain(segment: AudioClipPlan, inputIndex: number, options: AudioMixOptions): string {
  const { fps, sampleRate, channels, masterVolume = 1 } = options
  const label = inputIndex - 1
  const inSec = segment.sourceStartFrame / fps
  const outSec = (segment.sourceStartFrame + segment.frameCount) / fps
  const delayMs = Math.round((segment.startFrame / fps) * 1000)
  const gain = segment.volume * masterVolume
  const layout = channels === 1 ? 'mono' : 'stereo'

  return (
    `[${inputIndex}:a]atrim=start=${inSec}:end=${outSec},asetpts=PTS-STARTPTS,` +
    `aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=${layout},` +
    `volume=${gain},adelay=${delayMs}:all=1[a${label}]`
  )
}

/**
 * Build the full audio mix graph for an export, or `null` when there is
 * nothing to mix (no segments, or every segment muted) — the caller should
 * pass the encoder `-an` in that case.
 *
 * Segments with `volume === 0` (a muted track, folded in by the resolver) are
 * dropped before the graph is built: they would contribute silence to the
 * mix regardless, and each one costs a decoder ffmpeg has to spin up.
 */
export function buildAudioMix(segments: AudioClipPlan[], options: AudioMixOptions): AudioMixSpec | null {
  const active = segments.filter(segment => segment.volume !== 0)
  if (active.length === 0) return null

  const { fps, totalFrames, sampleRate, channels } = options
  const chains = active.map((segment, i) => buildSegmentChain(segment, i + 1, options))

  // amix's default `normalize=true` scales every input by 1/N, so an N-clip
  // mix would come out N times quieter than the browser export. Web Audio
  // sums without normalization — `normalize=0` is what matches it.
  const labels = active.map((_, i) => `[a${i}]`).join('')
  const mixed =
    active.length > 1
      ? `${chains.join(';')};${labels}amix=inputs=${active.length}:duration=longest:normalize=0[amix]`
      : chains[0]
  const mixedLabel = active.length > 1 ? 'amix' : 'a0'

  // apad + atrim (rather than -shortest) guarantees the mix is exactly
  // totalFrames / fps long: pad-then-trim is deterministic, whereas
  // -shortest against an infinitely-padding filter is a known fragile edge.
  const totalSec = totalFrames / fps
  const tail = `[${mixedLabel}]apad=whole_dur=${totalSec},atrim=end=${totalSec},asetpts=N/SR/TB[aout]`

  return {
    inputs: active.map(segment => ({ source: segment.source, clipId: segment.clipId })),
    filterComplex: `${mixed};${tail}`,
    outLabel: '[aout]',
    sampleRate,
    channels,
  }
}
