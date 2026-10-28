/**
 * Typed (colour/path) keyframe editing from the properties panel — the pure
 * half (PV-P5c-2).
 *
 * Mirrors `keyframeEdit.ts`'s scalar rule for a `vec`/`path` channel: once a
 * channel has keys, its field displays the sampled value at the playhead and
 * committing it writes a key there instead of the stored field/param.
 * `apps/web`'s vitest config covers `lib/**` only (Node, no DOM), so every
 * decision a colour/path field makes lives here rather than in the `.tsx`
 * wiring (`useKeyframeEditing.tsx`, `EffectRow.tsx`).
 *
 * Built on PV-P5c-1's writers (`setColorKeyframe`, `setPathKeyframe`,
 * `authoredColor`, `channelValueKind`) — never on hand-built `Keyframe`
 * objects, per PV-CONTRACTS.
 */

import {
  authoredColor,
  channelValueKind,
  formatColor,
  moveKeyframe as coreMoveKeyframe,
  normalizeKeys,
  normalizePathKeys,
  normalizeVecKeys,
  removeKeyframe,
  sampleColorChannel,
  samplePathChannel,
  setColorKeyframe,
  setPathKeyframe,
  vecToHex,
  type AnyKeyframeChannel,
  type BaselineContext,
  type ChannelValueKind,
  type Clip,
  type Keyframe,
} from '@elah/core'

export type TypedKeyState = 'none' | 'keyed' | 'on-key'

function typedKeysOf(clip: Clip, channel: AnyKeyframeChannel): Keyframe[] {
  return normalizeKeys(clip.keyframes?.channels?.[channel]?.keys)
}

function typedKeyAt(clip: Clip, channel: AnyKeyframeChannel, localFrame: number): Keyframe | undefined {
  return typedKeysOf(clip, channel).find((k) => k.frame === localFrame)
}

/** `channelValueKind`, re-exported here so a field only imports one module for its typed logic. */
export function typedKind(clip: Clip, channel: AnyKeyframeChannel): ChannelValueKind {
  return channelValueKind(clip, channel)
}

/** Whether a colour/path channel has at least one usable key OF ITS OWN KIND (a stray key missing `vec`/`path` does not count). */
export function isTypedKeyed(clip: Clip, channel: AnyKeyframeChannel): boolean {
  const kind = channelValueKind(clip, channel)
  if (kind === 'color') return normalizeVecKeys(typedKeysOf(clip, channel)).length > 0
  if (kind === 'path') return normalizePathKeys(typedKeysOf(clip, channel)).length > 0
  return false
}

/** Diamond state for a typed field: on-key at the playhead, keyed elsewhere, or none. */
export function typedKeyState(clip: Clip, channel: AnyKeyframeChannel, localFrame: number): TypedKeyState {
  if (!isTypedKeyed(clip, channel)) return 'none'
  return typedKeyAt(clip, channel, localFrame) ? 'on-key' : 'keyed'
}

/**
 * Effect colour params store `#rrggbb` only — `vecToHex`, never `formatColor`
 * (PV-P5c-1's gotcha). Every other colour channel (`color`, `shape.fill`,
 * `shape.stroke`) may carry alpha, so it goes through `formatColor`.
 */
function formatSampled(channel: AnyKeyframeChannel, vec: number[] | undefined): string | undefined {
  if (!vec) return undefined
  return channel.startsWith('fx.') ? vecToHex(vec) : formatColor(vec)
}

/** The colour a field should DISPLAY at the playhead: sampled once keyed, else the authored/stored colour. */
export function displayColor(clip: Clip, channel: AnyKeyframeChannel, localFrame: number): string | undefined {
  const keys = normalizeVecKeys(typedKeysOf(clip, channel))
  if (keys.length === 0) return authoredColor(clip, channel)
  return formatSampled(channel, sampleColorChannel(keys, localFrame)) ?? authoredColor(clip, channel)
}

/** The path a field should DISPLAY at the playhead: sampled/held once keyed, else the clip's stored `shapePath`. */
export function displayPath(clip: Clip, localFrame: number): string | undefined {
  const keys = normalizePathKeys(typedKeysOf(clip, 'shape.path'))
  if (keys.length === 0) return clip.shapePath
  return samplePathChannel(keys, localFrame) ?? clip.shapePath
}

/**
 * The diamond click for a colour field. On a key at the playhead → remove it.
 * Otherwise → write a key holding the channel's AUTHORED colour — never a
 * sampled/interpolated preview — which is `setColorKeyframe`'s own default
 * when no explicit colour is passed.
 */
export function toggleColorKey(
  clip: Clip,
  channel: AnyKeyframeChannel,
  localFrame: number,
  // Unused by the colour/path writers themselves (`SetKeyframeOptions`, not
  // `BaselineContext` — no transform baking for a typed channel), but kept on
  // every function here so a caller passes the SAME `ctx` it already has for
  // `commitScalar`/`toggleKeys`, without needing to know which writer cares.
  _ctx: BaselineContext,
): Partial<Clip> {
  const onKey = typedKeyAt(clip, channel, localFrame)
  if (onKey) return removeKeyframe(clip, channel, onKey.id)
  return setColorKeyframe(clip, channel, localFrame, undefined)
}

/** The diamond click for a `shape.path` field (path shapes only) — same rule as `toggleColorKey`. */
export function togglePathKey(clip: Clip, localFrame: number, _ctx: BaselineContext): Partial<Clip> {
  const channel: AnyKeyframeChannel = 'shape.path'
  const onKey = typedKeyAt(clip, channel, localFrame)
  if (onKey) return removeKeyframe(clip, channel, onKey.id)
  return setPathKeyframe(clip, localFrame, undefined)
}

/** The clip field a colour channel's UNKEYED edit writes. `fx.*` params are not clip fields — `effectStack.ts` owns that write. */
function baseColorPatch(channel: AnyKeyframeChannel, value: string): Partial<Clip> {
  if (channel === 'color') return { color: value }
  if (channel === 'shape.fill') return { shapeFill: value }
  if (channel === 'shape.stroke') return { shapeStroke: value }
  return {}
}

/** Route a colour commit: keyed → a key at the playhead in one patch, else the static clip field. */
export function commitColor(
  clip: Clip,
  channel: AnyKeyframeChannel,
  value: string,
  localFrame: number,
  _ctx: BaselineContext,
): Partial<Clip> {
  if (!isTypedKeyed(clip, channel)) return baseColorPatch(channel, value)
  return setColorKeyframe(clip, channel, localFrame, value)
}

/** Move a typed key in time only. `.vec`/`.path` ride along unchanged — core's `moveKeyframe` spreads the whole key and only overwrites `frame`/`value`. */
export function moveTypedKey(clip: Clip, channel: AnyKeyframeChannel, keyId: string, frame: number): Partial<Clip> {
  return coreMoveKeyframe(clip, channel, keyId, frame, 0)
}
