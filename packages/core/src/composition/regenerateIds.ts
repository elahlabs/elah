import { tokenize } from '../resolver/expr/tokenize'
import type { AnyKeyframeChannel, Clip, Project } from '../types'
import { generateId } from '../utils/id'

interface IdMap {
  clips: Map<string, string>
  /** Keyed by the OLD compound clip id. */
  children: Map<string, IdMap>
}

/**
 * Rewrite only the string argument of a `clip("id")` call whose value is a
 * mapped clip id — never `prop(...)`, an unrelated string, or text inside
 * another string. Uses the existing tokenizer so the grammar is not
 * duplicated; invalid tokenization (or nothing to rewrite) returns the
 * source unchanged, byte for byte.
 */
function rewriteExpressionClipRefs(source: string, clipMap: ReadonlyMap<string, string>): string {
  const result = tokenize(source)
  if (!result.ok) return source

  const tokens = result.tokens
  const edits: Array<{ start: number; end: number; text: string }> = []
  for (let i = 0; i + 3 < tokens.length; i++) {
    const idTok = tokens[i]!
    const openTok = tokens[i + 1]!
    const strTok = tokens[i + 2]!
    const closeTok = tokens[i + 3]!
    if (
      idTok.kind === 'id' &&
      idTok.text === 'clip' &&
      openTok.kind === 'op' &&
      openTok.text === '(' &&
      strTok.kind === 'str' &&
      closeTok.kind === 'op' &&
      closeTok.text === ')'
    ) {
      const mapped = clipMap.get(strTok.text)
      if (mapped !== undefined) {
        const quote = source[strTok.pos]!
        const start = strTok.pos
        const end = strTok.pos + strTok.text.length + 2 // + the two quote chars
        edits.push({ start, end, text: `${quote}${mapped}${quote}` })
      }
    }
  }
  if (edits.length === 0) return source

  edits.sort((a, b) => b.start - a.start) // right to left, so earlier positions never shift
  let out = source
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out
}

/** Walk the path's segments through nested `IdMap`s. Once a level's map is
 *  missing, later segments are left unchanged (they name a level regenerateIds
 *  never reached, which should not happen for a well-formed binding). */
function rewriteClipPath(path: string, map: IdMap): string {
  const segs = path.split('/')
  const out: string[] = []
  let current: IdMap | undefined = map
  for (const seg of segs) {
    if (!current) {
      out.push(seg)
      continue
    }
    out.push(current.clips.get(seg) ?? seg)
    current = current.children.get(seg)
  }
  return out.join('/')
}

/** One level of the tree: draw every id at this level, rewrite references
 *  that stay within it, recurse into compound children, then rewrite this
 *  level's own composition bindings (which need the child maps). */
function regenInPlace(p: Project): IdMap {
  // 1. Draw every id of THIS level first, in a fixed order, for determinism.
  const newProjectId = generateId()

  const trackMap = new Map<string, string>()
  for (const t of p.tracks) trackMap.set(t.id, generateId())

  const ordered: Array<[string, Clip]> = []
  const clipMap = new Map<string, string>()
  for (const t of p.tracks) {
    for (const c of p.clips[t.id] ?? []) {
      clipMap.set(c.id, generateId())
      ordered.push([c.id, c])
    }
  }

  const linkMap = new Map<string, string>()
  for (const [, c] of ordered) {
    if (c.linkId && !linkMap.has(c.linkId)) linkMap.set(c.linkId, generateId())
  }

  const transitionIds = p.transitions.map(() => generateId())
  const markerIds = (p.markers ?? []).map(() => generateId())
  const groupIds = (p.trackGroups ?? []).map(() => generateId())

  // 2. Rewrite. No generateId() calls past this point.
  p.id = newProjectId
  for (const t of p.tracks) t.id = trackMap.get(t.id)!

  const newClips: Record<string, Clip[]> = {}
  for (const [oldTrackId, bucket] of Object.entries(p.clips)) {
    const key = trackMap.get(oldTrackId) ?? oldTrackId
    for (const c of bucket) {
      c.id = clipMap.get(c.id) ?? c.id
      c.trackId = key
      if (c.linkId) c.linkId = linkMap.get(c.linkId) ?? c.linkId
      if (c.matte && clipMap.has(c.matte.sourceClipId)) {
        c.matte.sourceClipId = clipMap.get(c.matte.sourceClipId)!
      }
      if (c.layout?.anchorTo && clipMap.has(c.layout.anchorTo.clip)) {
        c.layout.anchorTo.clip = clipMap.get(c.layout.anchorTo.clip)!
      }
      if (c.layout?.fitTo && clipMap.has(c.layout.fitTo.clip)) {
        c.layout.fitTo.clip = clipMap.get(c.layout.fitTo.clip)!
      }
      const channels = c.keyframes?.channels
      if (channels) {
        for (const name of Object.keys(channels) as AnyKeyframeChannel[]) {
          const track = channels[name]
          if (track && track.source.kind === 'expression') {
            track.source.source = rewriteExpressionClipRefs(track.source.source, clipMap)
          }
        }
      }
    }
    newClips[key] = bucket
  }
  p.clips = newClips

  for (let i = 0; i < p.transitions.length; i++) {
    const x = p.transitions[i]!
    x.id = transitionIds[i]!
    x.fromClipId = clipMap.get(x.fromClipId) ?? x.fromClipId
    x.toClipId = clipMap.get(x.toClipId) ?? x.toClipId
    x.trackId = trackMap.get(x.trackId) ?? x.trackId
  }

  if (p.markers) {
    for (let i = 0; i < p.markers.length; i++) p.markers[i]!.id = markerIds[i]!
  }

  if (p.trackGroups) {
    for (let i = 0; i < p.trackGroups.length; i++) {
      const g = p.trackGroups[i]!
      g.id = groupIds[i]!
      g.trackIds = g.trackIds.map((id) => trackMap.get(id) ?? id)
    }
  }

  // 3. Children, after every id of this level has been drawn and rewritten.
  const children = new Map<string, IdMap>()
  for (const [oldId, c] of ordered) {
    if (c.compound?.project) children.set(oldId, regenInPlace(c.compound.project))
  }

  // 4. This level's own composition bindings, last (they need the child maps).
  if (p.composition) {
    for (const b of p.composition.bindings) {
      b.clipId = rewriteClipPath(b.clipId, { clips: clipMap, children })
    }
  }

  return { clips: clipMap, children }
}

/**
 * Every id in the tree replaced by `generateId()`, references rewired.
 * Deterministic only inside `withSeededIds`; `instantiate` provides that.
 * Effect ids, keyframe ids, asset ids, roto run ids and generator seeds are
 * kept — they are clip-local or name something outside the document tree,
 * never another id `regenerateIds` draws.
 */
export function regenerateIds(project: Project): Project {
  const out = structuredClone(project)
  regenInPlace(out)
  return out
}
