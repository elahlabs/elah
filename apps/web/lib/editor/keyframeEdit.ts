/**
 * Keyframe editing from the properties panel — the pure half.
 *
 * The panels show ONE set of fields for a clip. Once a channel has keys, that
 * channel's field means something different: it displays the sampled value at
 * the playhead, and committing it writes a key there instead of the static
 * value (CapCut's "just edit and it keys" behaviour, and the reason the diamond
 * is only clicked once). Everything that decides which of the two a field is
 * doing lives here, DOM-free, so it is covered by `apps/web`'s vitest config
 * (`lib/**` only).
 */

import {
  removeKeyframe,
  sampleKeyframes,
  setKeyframe,
  normalizeKeys,
  TRANSFORM_CHANNELS,
  type BaselineContext,
  type Clip,
  type Keyframe,
  type KeyframeChannel,
  type Transform,
} from '@elah/core'

/** `mergeTransform`'s shape: every optional channel filled in. */
export type EditableTransform = Transform & { scaleX: number; scaleY: number }

export type KeyState = 'none' | 'keyed' | 'on-key'

export type ScalarKeyChannel = Extract<KeyframeChannel, 'opacity' | 'volume' | 'cornerRadius'>

/** The playhead as a clip-relative frame, clamped into the clip so a key is
 *  always written somewhere the clip actually plays. */
export function clampLocalFrame(clip: Pick<Clip, 'startFrame' | 'durationFrames'>, currentFrame: number): number {
  const local = Math.floor(currentFrame) - clip.startFrame
  return Math.min(Math.max(0, local), Math.max(0, clip.durationFrames - 1))
}

function keysOf(clip: Clip, channel: KeyframeChannel): Keyframe[] {
  return normalizeKeys(clip.keyframes?.channels?.[channel]?.keys)
}

export function isKeyed(clip: Clip, channel: KeyframeChannel): boolean {
  return keysOf(clip, channel).length > 0
}

export function keyAt(clip: Clip, channel: KeyframeChannel, localFrame: number): Keyframe | undefined {
  return keysOf(clip, channel).find((k) => k.frame === localFrame)
}

/** State for a diamond that stands for one or more channels (Position = x + y). */
export function keyState(clip: Clip, channels: ReadonlyArray<KeyframeChannel>, localFrame: number): KeyState {
  let keyed = false
  for (const ch of channels) {
    if (keyAt(clip, ch, localFrame)) return 'on-key'
    if (isKeyed(clip, ch)) keyed = true
  }
  return keyed ? 'keyed' : 'none'
}

/**
 * The transform a field should DISPLAY: the merged authored transform with
 * every keyed channel replaced by its sampled value at the playhead.
 */
export function overlayKeyframes(clip: Clip, merged: EditableTransform, localFrame: number): EditableTransform {
  const s = sampleKeyframes(clip.keyframes, localFrame, merged)
  if (!s.transform) return merged
  return { ...merged, ...s.transform, scaleX: s.transform.scaleX ?? merged.scaleX, scaleY: s.transform.scaleY ?? merged.scaleY }
}

/** A scalar's display value: sampled when keyed, else the authored value. */
export function displayScalar(clip: Clip, channel: ScalarKeyChannel, localFrame: number, fallback: number): number {
  if (!isKeyed(clip, channel)) return clip[channel] ?? fallback
  const s = sampleKeyframes(clip.keyframes, localFrame, { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } })
  return s[channel] ?? clip[channel] ?? fallback
}

/**
 * Route a whole-transform commit.
 *
 * Unkeyed channels land in `transform` as they always have. A keyed channel
 * whose value actually changed (vs what the field was DISPLAYING, `current`)
 * gets a key at the playhead instead; its slot in `transform` keeps the
 * authored value so nothing static moves underneath the curve. Keyed channels
 * the user did not touch get no key — editing X must not sprinkle keys on Y.
 */
export function commitTransform(
  clip: Clip,
  current: EditableTransform,
  next: EditableTransform,
  localFrame: number,
  ctx: BaselineContext,
): Partial<Clip> {
  const keyed = TRANSFORM_CHANNELS.filter((ch) => isKeyed(clip, ch))
  if (keyed.length === 0) return { transform: next }

  const transform: EditableTransform = { ...next }
  for (const ch of keyed) {
    const authored = clip.transform?.[ch]
    if (authored !== undefined) transform[ch] = authored
  }

  let working: Clip = { ...clip, transform }
  let patch: Partial<Clip> = { transform }
  for (const ch of keyed) {
    if (next[ch] === current[ch]) continue
    const p = setKeyframe(working, ch, localFrame, ctx, next[ch])
    working = { ...working, ...p }
    patch = { ...patch, ...p }
  }
  return patch
}

/** Route a scalar commit: keyed → key at the playhead, else the static field. */
export function commitScalar(
  clip: Clip,
  channel: ScalarKeyChannel,
  value: number,
  localFrame: number,
  ctx: BaselineContext,
): Partial<Clip> {
  if (!isKeyed(clip, channel)) return { [channel]: value }
  return setKeyframe(clip, channel, localFrame, ctx, value)
}

/**
 * The diamond click. On a key → remove it (removing the last key un-keys the
 * channel, and the clip keeps whatever transform was baked, so nothing jumps).
 * Otherwise → write a key at the playhead holding the value the field shows.
 * Several channels toggle together (Position = x + y, Size = scaleX + scaleY).
 */
export function toggleKeys(
  clip: Clip,
  channels: ReadonlyArray<KeyframeChannel>,
  localFrame: number,
  ctx: BaselineContext,
  values: Partial<Record<KeyframeChannel, number>>,
): Partial<Clip> {
  const state = keyState(clip, channels, localFrame)
  let working: Clip = clip
  let patch: Partial<Clip> = {}
  for (const ch of channels) {
    const p =
      state === 'on-key'
        ? (() => {
            const k = keyAt(working, ch, localFrame)
            return k ? removeKeyframe(working, ch, k.id) : {}
          })()
        : setKeyframe(working, ch, localFrame, ctx, values[ch])
    working = { ...working, ...p }
    patch = { ...patch, ...p }
  }
  // `removeKeyframe` legitimately returns `{ keyframes: undefined }` when the
  // last channel goes; spreading that over `clip` must clear the field, which
  // `updateClip`'s Object.assign does with an explicit undefined.
  return patch
}
