/**
 * @elah/core/ops
 *
 * The agent-facing project summary and the edit-op layer: describe a project
 * (or one clip, a library, a set of transitions) as bounded JSON, then sanitize
 * and apply a plan of ops to a live `TimelineEngine`.
 *
 * This layer is live in 1.0 but is not part of the `@elah/core` root. It
 * is imported from its own subpath so that the root's semver promise stays
 * small and so that the root's "everything exported" bundle does not count it.
 * A bundler that tree-shakes already drops it from an app that never imports
 * it, so moving it did not change what a real app downloads.
 */

export { describeProject, MAX_DESCRIBED_PATH_LENGTH, MAX_DESCRIBED_PATH_TOTAL, MAX_DESCRIBED_PARTS, MAX_DESCRIBED_PARTS_TOTAL, MAX_DESCRIBED_ITEMS } from './describe'
export { planInstanceUpdate, validateInstanceOverrides, COMPONENT_FIELDS } from './componentEdit'
export type { InstanceUpdate, InstanceUpdatePlan, ComponentFieldName } from './componentEdit'
export { sanitizeOps } from './sanitize'
export type { SanitizeResult } from './sanitize'
export { applyOps, ASSISTANT_GRAPHICS_TRACK, ASSISTANT_MEDIA_TRACK } from './apply'
export type { ApplyContext } from './apply'
export { opDescriber, formatSeconds } from './describeOp'
export { describeLibrary, MAX_DESCRIBED_ASSETS } from './describeLibrary'
export type { DescribedAsset, LibraryAssetLike } from './describeLibrary'
export { describeClipDetail, describeTransitions, MAX_DETAIL_CLIPS, MAX_DETAIL_KEYS_PER_CHANNEL, MAX_DETAIL_CAPTION_WORDS, MAX_DETAIL_BYTES, MAX_DETAIL_CHILDREN } from './describeDetail'
export type { ClipDetail, ClipDetailResult, DescribeDetailOptions, DescribedTransition, DescribedTransitions, DetailKey, DetailPaint, DetailEffect, DetailText, DetailShape, DetailAnimation, DetailRef } from './describeDetail'
export { EDITOR_OP_NAMES, REGIONS, SHAPE_OP_KINDS } from './types'
export type { EditorOp, EditorOpName, EditPlan, ApplyResult, DeferredGeneration, DeferredBackgroundRemoval, KeyOp, Region, ShapeOpKind, OpParams } from './types'
export type {
  DescribedProject,
  DescribedTrack,
  DescribedClip,
  DescribedEffect,
  DescribeOptions,
  DescribedComposition,
  DescribedPart,
  DescribedInstance,
  DescribedPath,
} from './describe'
export { locateClip, patchClipAtPath } from './nested'
export type { LocatedClip } from './nested'
