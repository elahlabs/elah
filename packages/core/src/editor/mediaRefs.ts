import type { Clip, ClipMediaRef, Project } from '../types'
import { MEDIA_CLIP_TYPES } from './projectDocument'

/**
 * Stamping local-file references onto a project at save time (LM-P1).
 *
 * `insertMediaAsset` lives in `packages/timeline` and must not change, and an
 * `updateClip` on insert would add a history entry, so the reference is copied
 * from the media library onto each clip just before the document is saved.
 * The saved document then carries `clip.media` next to a `blob:` src that will
 * be dead after a reload; `relinkProjectMedia`'s `remint` is what uses it.
 */

export interface StampableAsset {
  id: string
  src: string
  media?: ClipMediaRef
}

function sameRef(a: ClipMediaRef | undefined, b: ClipMediaRef): boolean {
  if (a === b) return true
  if (!a) return false
  if (
    a.v !== b.v ||
    a.id !== b.id ||
    a.name !== b.name ||
    a.byteSize !== b.byteSize ||
    a.lastModified !== b.lastModified ||
    a.kind !== b.kind ||
    a.mime !== b.mime
  ) {
    return false
  }
  if (!a.folder || !b.folder) return !a.folder && !b.folder
  return a.folder.name === b.folder.name && a.folder.path.join('\u0000') === b.folder.path.join('\u0000')
}

interface Lookup {
  byId: Map<string, ClipMediaRef>
  bySrc: Map<string, ClipMediaRef>
}

function stampProject(project: Project, lookup: Lookup): Project {
  let changed = false
  const nextClips: Project['clips'] = {}

  for (const [trackId, bucket] of Object.entries(project.clips)) {
    let bucketChanged = false
    const nextBucket = bucket.map((clip): Clip => {
      if (clip.type === 'compound' && clip.compound) {
        const inner = stampProject(clip.compound.project, lookup)
        if (inner === clip.compound.project) return clip
        bucketChanged = true
        return { ...clip, compound: { ...clip.compound, project: inner } }
      }
      if (!MEDIA_CLIP_TYPES.has(clip.type)) return clip

      const ref =
        (clip.assetId !== undefined ? lookup.byId.get(clip.assetId) : undefined) ??
        (clip.src !== undefined ? lookup.bySrc.get(clip.src) : undefined)
      if (!ref || sameRef(clip.media, ref)) return clip
      bucketChanged = true
      return { ...clip, media: ref }
    })
    nextClips[trackId] = bucketChanged ? nextBucket : bucket
    if (bucketChanged) changed = true
  }

  return changed ? { ...project, clips: nextClips } : project
}

/** Cheap signature of what stamping reads from the assets. */
function assetsKey(assets: readonly StampableAsset[]): string {
  let key = ''
  for (const a of assets) {
    key += `${a.id}\u0001${a.src}\u0001${a.media ? `${a.media.id}\u0002${a.media.folder?.path.join('/') ?? ''}` : ''}\u0003`
  }
  return key
}

const memo = new WeakMap<Project, { key: string; result: Project }>()

/**
 * Copies each asset's `media` onto the clips that use it: matched by
 * `assetId`, else by `src`. A clip whose asset is gone keeps the `media` it
 * already has. Compound clips are walked into.
 *
 * Returns the SAME project object when nothing changes, and the SAME result
 * object when called again with the same project and an equivalent asset list,
 * because autosave compares documents by identity and would otherwise save
 * every re-announce.
 */
export function stampMediaRefs(project: Project, assets: Iterable<StampableAsset>): Project {
  const list = Array.from(assets)
  const key = assetsKey(list)
  const hit = memo.get(project)
  if (hit && hit.key === key) return hit.result

  const lookup: Lookup = { byId: new Map(), bySrc: new Map() }
  for (const a of list) {
    if (!a.media) continue
    lookup.byId.set(a.id, a.media)
    if (!lookup.bySrc.has(a.src)) lookup.bySrc.set(a.src, a.media)
  }

  const result = stampProject(project, lookup)
  memo.set(project, { key, result })
  return result
}
