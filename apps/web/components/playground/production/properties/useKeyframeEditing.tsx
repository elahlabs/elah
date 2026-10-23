'use client'

import type { Dispatch, SetStateAction } from 'react'
import { usePlaybackStore, useTimelineEngine } from '@elah/editor'
import type {
  AnyKeyframeChannel,
  BaselineContext,
  Clip,
  KeyframeChannel,
  Transform,
} from '@elah/core'
import {
  clampLocalFrame,
  commitScalar,
  commitTransform,
  displayScalar,
  keyState,
  overlayKeyframes,
  toggleKeys,
  type EditableTransform,
  type ScalarKeyChannel,
} from '@/lib/editor/keyframeEdit'
// PV-P5c-2: the typed (colour/path) half of the same idea, kept in its own
// pure module (`channelValueKind`, `vec`/`path` keys) rather than folded into
// `keyframeEdit.ts`'s scalar rules.
import {
  commitColor,
  displayColor,
  displayPath,
  toggleColorKey,
  togglePathKey,
  typedKeyState,
} from '@/lib/editor/typedKeyframes'
import { mergeTransform } from './propertiesShared'
import { KeyframeDiamond } from './KeyframeDiamond'

/**
 * Keyframe-aware editing for a properties panel.
 *
 * The panel keeps its existing `local` optimistic state for the type-then-blur
 * fields. This hook layers the two things keyframes change on top of it:
 *
 *  - DISPLAY: `tf` and `scalar()` show the sampled value at the playhead for
 *    any keyed channel, the authored value otherwise. In-progress local edits
 *    win over the sample so a field never snaps back while being typed in.
 *  - COMMIT: `commitTf` / `commitScalar` route a keyed channel to a key at the
 *    playhead (via `lib/editor/keyframeEdit`) and everything else to the static
 *    field, exactly as before.
 *
 * Keyframe patches are written to the engine only, never mirrored into
 * `local`: the tracks store syncs synchronously on `change`, so the fresh clip
 * is already in hand on the next render, and a stale `local.keyframes` would
 * otherwise mask an undo.
 */
export function useKeyframeEditing(
  clip: Clip,
  local: Partial<Clip>,
  setLocal: Dispatch<SetStateAction<Partial<Clip>>>,
  ctx: BaselineContext,
  baseline?: Transform,
) {
  const engine = useTimelineEngine()
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const localFrame = clampLocalFrame(clip, currentFrame)

  const sampledTf = overlayKeyframes(clip, mergeTransform(clip, baseline), localFrame)
  const tf: EditableTransform = { ...sampledTf, ...local.transform }

  const write = (patch: Partial<Clip>) => engine.updateClip(clip.id, clip.trackId, patch)
  const dropLocalTransform = () =>
    setLocal((prev) => {
      const { transform: _dropped, ...rest } = prev
      return rest
    })

  const setTf = (patch: Partial<EditableTransform>) =>
    setLocal((prev) => ({ ...prev, transform: { ...sampledTf, ...prev.transform, ...patch } }))

  const commitTf = () => {
    write(commitTransform(clip, sampledTf, tf, localFrame, ctx))
    dropLocalTransform()
  }

  /** Write a transform patch straight through — for buttons and sliders,
   *  which have no type-then-blur phase to defer the commit to. */
  const commitTfPatch = (patch: Partial<EditableTransform>) => {
    write(commitTransform(clip, sampledTf, { ...tf, ...patch }, localFrame, ctx))
    dropLocalTransform()
  }

  const scalar = (channel: ScalarKeyChannel, fallback: number) =>
    displayScalar({ ...clip, ...local }, channel, localFrame, fallback)

  const commitScalarValue = (channel: ScalarKeyChannel, value: number) => {
    const patch = commitScalar(clip, channel, value, localFrame, ctx)
    if (patch.keyframes === undefined) setLocal((prev) => ({ ...prev, ...patch }))
    write(patch)
  }

  const diamond = (
    label: string,
    channels: ReadonlyArray<KeyframeChannel>,
    values: Partial<Record<KeyframeChannel, number>>,
  ) => (
    <KeyframeDiamond
      state={keyState(clip, channels, localFrame)}
      label={label}
      onClick={() => write(toggleKeys(clip, channels, localFrame, ctx, values))}
    />
  )

  // --- PV-P5c-2: colour fields (text/shape fill/stroke solid colour) -------
  // A keyed colour's DISPLAY comes from the sampler, which has no notion of
  // "what's in the text box right now" — unlike `tf`, `local` has to win
  // explicitly here rather than through a spread, or a keystroke on an
  // already-keyed field would never show up until blur.
  const localColorField = (channel: AnyKeyframeChannel): string | undefined => {
    if (channel === 'color') return local.color
    if (channel === 'shape.fill') return local.shapeFill
    if (channel === 'shape.stroke') return local.shapeStroke
    return undefined
  }

  const color = (channel: AnyKeyframeChannel, fallback: string) =>
    localColorField(channel) ?? displayColor(clip, channel, localFrame) ?? fallback

  const commitColorValue = (channel: AnyKeyframeChannel, value: string, extra?: Partial<Clip>) => {
    const patch = { ...commitColor(clip, channel, value, localFrame, ctx), ...extra }
    if (patch.keyframes === undefined) {
      // Same rule as `commitScalarValue`: an unkeyed write is mirrored into
      // `local` so the field shows it immediately, before the engine's own
      // re-render lands.
      setLocal((prev) => ({ ...prev, ...patch }))
    } else if (localColorField(channel) !== undefined) {
      // A keyframe write is never mirrored into `local` (the tracks store
      // already has the fresh clip by the next render) — and any optimistic
      // echo from typing must be dropped now, or it would mask the engine's
      // own (possibly re-sampled) value forever, not just until the next edit.
      const field = channel === 'color' ? 'color' : channel === 'shape.fill' ? 'shapeFill' : 'shapeStroke'
      setLocal((prev) => {
        const { [field]: _dropped, ...rest } = prev
        return rest
      })
    }
    write(patch)
  }

  /** A colour diamond. `disabledReason` (e.g. a gradient Paint fill) makes it inert instead of hidden. */
  const colorDiamond = (label: string, channel: AnyKeyframeChannel, disabledReason?: string) => (
    <KeyframeDiamond
      state={typedKeyState(clip, channel, localFrame)}
      label={label}
      disabledReason={disabledReason}
      onClick={() => write(toggleColorKey(clip, channel, localFrame, ctx))}
    />
  )

  // MG-P4: the `shape.path` morph diamond (path shapes only). It keys the
  // CURRENT `shapePath` at the playhead through the core writer; the path text
  // itself is read-only in this panel, so there is no commit counterpart.
  const pathDiamond = (label: string, disabledReason?: string) => (
    <KeyframeDiamond
      state={typedKeyState(clip, 'shape.path', localFrame)}
      label={label}
      disabledReason={disabledReason}
      onClick={() => write(togglePathKey(clip, localFrame, ctx))}
    />
  )

  /** The path to DISPLAY at the playhead: sampled/held once keyed, else the stored `shapePath`. */
  const path = () => displayPath({ ...clip, ...local }, localFrame)

  return {
    localFrame,
    tf,
    setTf,
    commitTf,
    commitTfPatch,
    scalar,
    commitScalar: commitScalarValue,
    diamond,
    color,
    commitColor: commitColorValue,
    colorDiamond,
    pathDiamond,
    path,
  }
}
