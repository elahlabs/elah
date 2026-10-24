/**
 * elements/group.ts — a `group` spec element -> a `compound` `Clip` literal
 * (AV-1).
 *
 * A group's own compiler is `compile.ts`'s `compileLevel` (recursive), passed
 * in as `compileChildren` rather than imported directly — `compile.ts` owns
 * the id-assignment/element-clip-id-map machinery a level needs, and this
 * file would otherwise have to import it back, a circular import for no
 * reason. Dependency injection keeps the direction one-way: compile.ts ->
 * elements/group.ts -> (calls back into compile.ts's own function value).
 *
 * The compound's on-timeline length is the GROUP's authored duration, not
 * whatever `getTotalFrames` says about its children — `createClip` derives a
 * compound's length from its children, which is exactly the trap the ticket
 * calls out: a group whose children do not span its full duration would
 * otherwise come out the wrong length. Setting `durationFrames` /
 * `sourceDurationFrames` / `assetFrames` explicitly, after building the
 * child, sidesteps `createClip` entirely (this file never calls it).
 */

import type { Clip, Project } from '../../types'
import type { SpecElement } from '../types'
import { applyEffectsAndBlend, applyMotionAndKeyframes, baseClip, buildTransform, type BuildContext } from './common'

/** Builds the child `Project` at `depth + 1`; fonts it resolves land in the shared `ctx.fontIds` set, so the caller need not collect anything back. */
export type CompileChildren = (children: SpecElement[], durationFrames: number, groupPath: string) => Project

export function buildGroupClip(
  el: SpecElement,
  input: { id: string; trackId: string; startFrame: number; durationFrames: number },
  ctx: BuildContext,
  path: string,
  compileChildren: CompileChildren,
): Clip {
  const transform = buildTransform(el, ctx, path)
  const project = compileChildren(el.children ?? [], input.durationFrames, path)

  let clip: Clip = {
    ...baseClip({ ...input, type: 'compound', name: el.name ?? 'group', transform }, el, ctx, path),
    compound: { project },
    sourceDurationFrames: input.durationFrames,
    assetFrames: input.durationFrames,
  }

  clip = applyMotionAndKeyframes(clip, el, ctx, path)
  clip = applyEffectsAndBlend(clip, el, ctx, path)
  return clip
}
