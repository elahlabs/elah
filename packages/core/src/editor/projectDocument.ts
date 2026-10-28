import type {
  AudioMarkerSet,
  Clip,
  ClipComponentInstance,
  ClipSceneSource,
  ClipCompound,
  ClipMediaRef,
  Effect,
  InOutRange,
  Marker,
  Project,
  ProjectAuthored,
  Track,
  TrackGroup,
  TrackKind,
  Transition,
  TransitionKind,
} from '../types'
import type { AuthoredAsset } from '../types/authored'
import { MAX_COMPOUND_DEPTH } from '../types'
import { TRANSITION_KINDS as REGISTERED_TRANSITION_KINDS, TRANSITION_REGISTRY } from '../transitions/registry'
import type { Binding, ProjectComposition, PropDef, PropType, PropValue } from '../composition/types'
import { PROP_NAME_RE, PROP_TYPES, coerceProp, fallbackValue, parseClipPath, parseFieldPath } from '../composition'
import { readClipAudio } from '../audio/clipAudio'

/**
 * Reading a stored composition back into the engine.
 *
 * A `Project` that has been through `JSON.stringify` and back is not a
 * `Project` — it is `unknown`. It may have been written by an older build, by a
 * newer one, or by nothing at all, and `TimelineEngine.loadProject` replaces the
 * whole composition with it. Everything the engine and the React stores
 * dereference without a guard (`project.stage.width`, `clips[track.id]`,
 * `tracks.map`) has to be established *here*, once, before that swap happens.
 *
 * The split of responsibility is deliberate:
 *
 *  - **Repair what is missing.** A document with no `stage` / `transitions` /
 *    `masterVolume` predates those fields. Defaulting them loses nothing and
 *    opens the project, which is the whole point.
 *  - **Refuse what is wrong.** A document whose `tracks` is not a list, or whose
 *    clips have no positions, is not a composition this build can show. Opening
 *    it as "empty" would be a lie the first autosave makes permanent, so it
 *    throws {@link ProjectDocumentError} and the caller shows the user why.
 *
 * Nothing here drops a clip. A clip whose media has gone missing is still the
 * user's work and still has a position, a duration and a name; see
 * {@link relinkProjectMedia} for what happens to it instead.
 */

/**
 * The document schema this build writes and reads.
 *
 * Bump it only when a stored document needs a real migration — the number is a
 * promise to every build that reads it, not a version of the app.
 */
export const PROJECT_VERSION = 5

/**
 * Transition kinds a version-1/2 build can draw. Anything else (EDX-P9c)
 * needs version 3.
 */
const V1_TRANSITION_KINDS: ReadonlySet<string> = new Set(TRANSITION_REGISTRY.filter((t) => t.legacy).map((t) => t.kind))

/**
 * The lowest version a project can be stamped with and still mean what it
 * says. Each version is a promise about what an older build would refuse:
 *   - 2 (EDX-P7): `adjustment` clips;
 *   - 3 (EDX-P9): `generator` clips, shape draw-on, and the new
 *     transition kinds;
 *   - 4 (PV-P1): `compound` clips;
 *   - 5 (PV-P8): `sequence` clips.
 * Every other EDX field is optional and safely ignored by older builds, so a
 * project is stamped higher only when it actually uses one of these.
 */
export function documentVersionFor(project: Pick<Project, 'clips'> & { transitions?: Project['transitions'] }): number {
  // A sequence clip is the newest thing a document can hold and must win over
  // every other rank regardless of where it sits in the clip list — including
  // AFTER a compound clip, which the loop below would otherwise return on
  // immediately. So it gets its own pass, checked first.
  for (const list of Object.values(project.clips)) {
    for (const c of list) {
      if (c.type === 'sequence') return 5
    }
  }

  let version = 1
  for (const list of Object.values(project.clips)) {
    for (const c of list) {
      // A compound is otherwise the newest thing a document can hold, and it wins outright.
      if (c.type === 'compound') return 4
      if (c.type === 'generator' || c.shapeDraw) version = 3
      if (c.type === 'adjustment' && version < 2) version = 2
    }
  }
  if (version < 3 && project.transitions?.some((t) => !V1_TRANSITION_KINDS.has(t.kind))) return 3
  return version
}

/** Stage used when a document carries none. Matches `TimelineEngine`'s own default. */
const DEFAULT_STAGE = { width: 1080, height: 1920 } as const

/** Track volume for a document written before tracks had one. Unity = no change. */
const DEFAULT_TRACK_VOLUME = 1

const TRACK_KINDS: ReadonlySet<string> = new Set<TrackKind>(['video', 'audio', 'elements'])
const CLIP_TYPES: ReadonlySet<string> = new Set([
  'video',
  'audio',
  'text',
  'image',
  'shape',
  'freehand',
  'adjustment',
  'generator',
  'compound',
  'sequence',
])
/** Every kind the registry knows (EDX-P9c); a newer, unknown kind is dropped, not fatal. */
const TRANSITION_KINDS: ReadonlySet<string> = new Set<TransitionKind>(REGISTERED_TRANSITION_KINDS)

/**
 * Why a stored document could not be opened.
 *
 * `'unreadable'` — the shape is not a composition (or is damaged past repair).
 * `'unsupported-version'` — it was written by a *newer* build than this one.
 * Kept apart because they are different sentences to the user: one is "this
 * file is broken", the other is "update, or open it where you saved it".
 */
export type ProjectDocumentErrorCode = 'unreadable' | 'unsupported-version'

/**
 * Thrown by {@link readProjectDocument}. Typed so the editor can decide what to
 * say without matching on message text — `message` here is for logs, not for
 * the screen.
 */
export class ProjectDocumentError extends Error {
  readonly code: ProjectDocumentErrorCode
  /** The version stamped on the document, when it had a readable one. */
  readonly documentVersion: number | undefined

  constructor(code: ProjectDocumentErrorCode, message: string, documentVersion?: number) {
    super(message)
    this.name = 'ProjectDocumentError'
    this.code = code
    this.documentVersion = documentVersion
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function unreadable(what: string): never {
  throw new ProjectDocumentError('unreadable', `Stored composition is unreadable: ${what}.`)
}

/** Non-negative integer frame position, clamped rather than rejected. */
function toFrameCount(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.round(value))
}

/** Linear gain, clamped to the 0..2 range the type documents. */
function toGain(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(2, value))
}

/**
 * Read the version stamp.
 *
 * A document with no `version` at all predates the stamp and is v1 — that is
 * what the field's absence means, and refusing it would strand the earliest
 * saved projects. A *newer* version is the one case this build cannot guess at:
 * the fields it doesn't know about are exactly the ones it would drop on the
 * next autosave, so it refuses instead.
 */
function readVersion(raw: unknown): number {
  if (raw === undefined || raw === null) return 1
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    unreadable('the version stamp is not a whole number')
  }
  if (raw > PROJECT_VERSION) {
    throw new ProjectDocumentError(
      'unsupported-version',
      `Stored composition is version ${raw}; this build reads up to ${PROJECT_VERSION}.`,
      raw,
    )
  }
  return raw
}

/**
 * Bring an older document up to date.
 *
 * v1 → v2 → v3 → v4 → v5 need no data change (each only ADDS types:
 * adjustment clips; generators, draw-on and new transitions; compound clips;
 * sequence clips (PV-P8)), so this only fixes the stamp: the lowest version
 * that describes the content ({@link documentVersionFor}), never lower than
 * what was stored.
 */
function migrate(project: Project, from: number): Project {
  const version = Math.max(from, documentVersionFor(project))
  return project.version === version ? project : { ...project, version }
}

function readTrack(raw: unknown, order: number, defaultHeight: number): Track {
  if (!isPlainObject(raw)) unreadable('a track is not an object')
  if (typeof raw.id !== 'string' || raw.id.length === 0) unreadable('a track has no id')
  if (typeof raw.kind !== 'string' || !TRACK_KINDS.has(raw.kind)) {
    unreadable(`track "${raw.id}" has an unknown kind`)
  }

  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : `Track ${order + 1}`,
    kind: raw.kind as TrackKind,
    order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : order,
    height: isPositiveFinite(raw.height) ? raw.height : defaultHeight,
    locked: raw.locked === true,
    disabled: raw.disabled === true,
    muted: raw.muted === true,
    solo: raw.solo === true,
    // Both are written unconditionally by `createTrack`, so writing them
    // unconditionally here is what makes a save → restore round-trip an
    // identity rather than a quiet reshaping of every track.
    volume: toGain(raw.volume, DEFAULT_TRACK_VOLUME),
    protected: raw.protected === true,
    // Dropping this on the way back in would silently un-pin the bottom bar on
    // every reload, and `addTrack` would go back to appending below it. Matched
    // against the literal rather than cast, so an unrecognised stored value
    // reads as unpinned instead of ordering tracks around a value nothing else
    // understands.
    pinned: raw.pinned === 'bottom' ? 'bottom' : undefined,
    // PV-T1. Written only when present so a document without them reads to
    // exactly the object it did before. `role` means something on a video
    // track only; anywhere else it is dropped rather than obeyed.
    ...(raw.role === 'main' && raw.kind === 'video' ? { role: 'main' as const } : {}),
    ...(typeof raw.color === 'string' && raw.color.length > 0 ? { color: raw.color } : {}),
  }
}

/**
 * At most one main track (PV-T1): the lowest-order one keeps the role. Two
 * would make "the magnetic track" ambiguous, and the engine only ever writes
 * one, so a second can only come from a hand-edited or merged document.
 */
function keepOneMainTrack(tracks: Track[]): Track[] {
  const mains = tracks.filter((t) => t.role === 'main')
  if (mains.length <= 1) return tracks
  const keep = mains.reduce((a, b) => (b.order < a.order ? b : a))
  return tracks.map((t) => {
    if (t.role !== 'main' || t === keep) return t
    const { role: _drop, ...rest } = t
    return rest
  })
}

/**
 * Track groups that still name real tracks (PV-T1). A group is a view
 * grouping, so dropping a damaged one loses a collapsed row, never content.
 * A track claimed by two groups stays in the first.
 */
function readTrackGroups(raw: unknown, trackIds: ReadonlySet<string>): TrackGroup[] | null {
  if (!Array.isArray(raw)) return null
  const claimed = new Set<string>()
  const out: TrackGroup[] = []
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue
    if (typeof entry.id !== 'string' || entry.id.length === 0) continue
    if (!Array.isArray(entry.trackIds)) continue
    const ids: string[] = []
    for (const id of entry.trackIds) {
      if (typeof id !== 'string' || !trackIds.has(id) || claimed.has(id)) continue
      claimed.add(id)
      ids.push(id)
    }
    if (ids.length === 0) continue
    out.push({
      id: entry.id,
      name: typeof entry.name === 'string' ? entry.name : 'Group',
      trackIds: ids,
      collapsed: entry.collapsed === true,
    })
  }
  return out.length > 0 ? out : null
}

/** The longest `Clip.partId` kept (EG-P1). A spec element id is a short slug; anything longer is not one. */
const MAX_PART_ID_LENGTH = 200

/** The largest `Project.authored`, as JSON, that is kept (EG-P1). A bigger one is dropped, not truncated. */
const MAX_AUTHORED_JSON_LENGTH = 512 * 1024

/** `JSON.stringify(value).length`, or `null` when the value cannot be serialised (a cycle, a BigInt). */
function jsonLength(value: unknown): number | null {
  try {
    const text = JSON.stringify(value)
    return text === undefined ? null : text.length
  } catch {
    return null
  }
}

/**
 * Structural check of a stored `Clip.component` (EG-P1). Anything that fails
 * is dropped by the caller, silently: provenance is advisory, and a clip with
 * a bad record is still a perfectly good clip.
 */
function isComponentInstance(raw: unknown): raw is ClipComponentInstance {
  if (!isPlainObject(raw)) return false
  if (raw.v !== 1) return false
  if (typeof raw.name !== 'string' || raw.name.length === 0) return false
  if (!isPlainObject(raw.input)) return false
  if (typeof raw.seed !== 'number' || !Number.isFinite(raw.seed)) return false
  if (!isPlainObject(raw.style) || typeof raw.style.energy !== 'string') return false
  if (raw.design !== undefined && !isPlainObject(raw.design)) return false
  return true
}

/** The largest html or css kept on `Clip.scene`, per field (CMP-EDIT-3). */
const MAX_SCENE_SOURCE_CHARS = 64 * 1024

/** Structural check of a stored `Clip.scene` (CMP-EDIT-3). Dropped by the caller when it fails. */
function isSceneSource(raw: unknown): raw is ClipSceneSource {
  if (!isPlainObject(raw)) return false
  if (raw.v !== 1) return false
  if (typeof raw.html !== 'string' || raw.html.length > MAX_SCENE_SOURCE_CHARS) return false
  if (typeof raw.css !== 'string' || raw.css.length > MAX_SCENE_SOURCE_CHARS) return false
  if (typeof raw.name !== 'string') return false
  if (typeof raw.duration !== 'number' || !Number.isFinite(raw.duration) || raw.duration <= 0) return false
  return true
}

const MEDIA_ID_RE = /^local:[0-9a-f]{64}$/
const MEDIA_KINDS: ReadonlySet<unknown> = new Set(['video', 'audio', 'image'])
const MAX_MEDIA_NAME_LENGTH = 512
const MAX_MEDIA_MIME_LENGTH = 128
const MAX_MEDIA_FOLDER_DEPTH = 64

function isNonNegativeFinite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0
}

/**
 * A stored `Clip.media` (LM-P1), rebuilt field by field, or `null` when it is
 * malformed. Advisory like `component`: a clip with a bad record is still a
 * perfectly good clip, so the caller just drops the field.
 */
function readClipMedia(raw: unknown): ClipMediaRef | null {
  if (!isPlainObject(raw)) return null
  if (raw.v !== 1) return null
  if (typeof raw.id !== 'string' || !MEDIA_ID_RE.test(raw.id)) return null
  if (typeof raw.name !== 'string' || raw.name.length > MAX_MEDIA_NAME_LENGTH) return null
  if (!isNonNegativeFinite(raw.byteSize) || !isNonNegativeFinite(raw.lastModified)) return null
  if (!MEDIA_KINDS.has(raw.kind)) return null
  if (raw.mime !== undefined && (typeof raw.mime !== 'string' || raw.mime.length > MAX_MEDIA_MIME_LENGTH)) return null
  let folder: ClipMediaRef['folder']
  if (raw.folder !== undefined) {
    const f = raw.folder
    if (!isPlainObject(f) || typeof f.name !== 'string' || !Array.isArray(f.path)) return null
    if (f.path.length < 1 || f.path.length > MAX_MEDIA_FOLDER_DEPTH) return null
    for (const seg of f.path) {
      if (typeof seg !== 'string' || seg.length === 0 || seg === '..' || seg === '.') return null
    }
    folder = { name: f.name, path: [...(f.path as string[])] }
  }
  return {
    v: 1,
    id: raw.id,
    name: raw.name,
    byteSize: raw.byteSize,
    lastModified: raw.lastModified,
    kind: raw.kind as ClipMediaRef['kind'],
    ...(raw.mime !== undefined ? { mime: raw.mime as string } : {}),
    ...(folder ? { folder } : {}),
  }
}

/** A stored `Project.authored`, or `null` when it is malformed or over the size guard (EG-P1). */
function readAuthored(raw: unknown): ProjectAuthored | null {
  if (!isPlainObject(raw)) return null
  if (raw.v !== 1) return null
  if (!isPlainObject(raw.spec)) return null
  if (typeof raw.seed !== 'number' || !Number.isFinite(raw.seed)) return null
  if (typeof raw.createdAt !== 'string') return null
  const size = jsonLength(raw)
  if (size === null || size > MAX_AUTHORED_JSON_LENGTH) return null
  const assets = readAuthoredAssets(raw.assets)
  return {
    v: 1,
    spec: raw.spec,
    ...(raw.treatment !== undefined && jsonLength(raw.treatment) !== null ? { treatment: raw.treatment } : {}),
    seed: raw.seed,
    ...(typeof raw.model === 'string' ? { model: raw.model } : {}),
    createdAt: raw.createdAt,
    ...(assets ? { assets } : {}),
  }
}

/** The most stored SVGs `Project.authored.assets` keeps (SVG-2); a plan places at most 12. */
const MAX_AUTHORED_ASSETS = 12
const MAX_AUTHORED_ASSET_URL_LENGTH = 2000
const MAX_AUTHORED_ASSET_NAME_LENGTH = 40

/** One stored SVG, or `null` when it is malformed. Never throws. */
function readAuthoredAsset(raw: unknown): AuthoredAsset | null {
  if (!isPlainObject(raw)) return null
  if (typeof raw.name !== 'string' || raw.name.length === 0 || raw.name.length > MAX_AUTHORED_ASSET_NAME_LENGTH) return null
  if (typeof raw.url !== 'string' || !raw.url.startsWith('https://') || raw.url.length > MAX_AUTHORED_ASSET_URL_LENGTH) return null
  if (raw.source !== 'drawn' && raw.source !== 'found') return null
  let credit: AuthoredAsset['credit']
  if (isPlainObject(raw.credit)) {
    const c = raw.credit
    if (
      typeof c.provider === 'string' && typeof c.set === 'string' && typeof c.name === 'string' &&
      typeof c.licence === 'string' && typeof c.pageUrl === 'string' &&
      c.provider.length <= 120 && c.set.length <= 120 && c.name.length <= 120 && c.licence.length <= 120 && c.pageUrl.length <= MAX_AUTHORED_ASSET_URL_LENGTH
    ) {
      credit = {
        provider: c.provider,
        set: c.set,
        name: c.name,
        licence: c.licence,
        pageUrl: c.pageUrl,
        ...(typeof c.author === 'string' && c.author.length <= 120 ? { author: c.author } : {}),
      }
    }
  }
  return {
    name: raw.name,
    url: raw.url,
    source: raw.source,
    ...(credit ? { credit } : {}),
    ...(typeof raw.model === 'string' && raw.model.length <= 120 ? { model: raw.model } : {}),
  }
}

/** `Project.authored.assets` (SVG-2): at most 12 well-formed entries. A bad entry is dropped, never the record. */
function readAuthoredAssets(raw: unknown): AuthoredAsset[] | null {
  if (!Array.isArray(raw)) return null
  const out: AuthoredAsset[] = []
  for (const entry of raw) {
    if (out.length >= MAX_AUTHORED_ASSETS) break
    const asset = readAuthoredAsset(entry)
    if (asset) out.push(asset)
  }
  return out.length > 0 ? out : null
}

/**
 * Clips are copied through by value rather than re-validated field by field.
 *
 * Only the fields the timeline *indexes* — id, type, name, position, length —
 * decide whether a clip can be shown at all; everything else (colours, fonts,
 * transforms, trim windows) already has a renderer-side default, and a clip
 * that reaches the canvas with a stale style is a visible, fixable problem
 * whereas a clip this function threw away is not.
 */
/** A stored `Clip.shadow` (MC-1d): a colour string and three finite numbers. */
function isClipShadow(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  return (
    typeof value.color === 'string' &&
    [value.blur, value.offsetX, value.offsetY].every((n) => typeof n === 'number' && Number.isFinite(n))
  )
}

/** A stored `Clip.cornerRadii` (MC-1d): exactly four finite numbers. */
function isCornerRadii(value: unknown): boolean {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number' && Number.isFinite(n))
}

function readClip(raw: unknown, trackId: string, index: number, depth: number, fps: number): Clip {
  if (!isPlainObject(raw)) unreadable(`a clip on track "${trackId}" is not an object`)
  if (typeof raw.id !== 'string' || raw.id.length === 0) unreadable('a clip has no id')
  if (typeof raw.type !== 'string' || !CLIP_TYPES.has(raw.type)) {
    unreadable(`clip "${raw.id}" has an unknown type`)
  }
  if (typeof raw.startFrame !== 'number' || !Number.isFinite(raw.startFrame)) {
    unreadable(`clip "${raw.id}" has no position on the timeline`)
  }
  if (!isPositiveFinite(raw.durationFrames)) {
    unreadable(`clip "${raw.id}" has no length`)
  }

  const durationFrames = Math.max(1, Math.round(raw.durationFrames))
  const effects = readEffects(raw.effects)

  const clip: Clip = {
    ...(raw as unknown as Clip),
    // The bucket key wins: a clip filed under a track it doesn't name would
    // otherwise be invisible to every lookup that goes clip → track.
    trackId,
    name: typeof raw.name === 'string' ? raw.name : `Clip ${index + 1}`,
    startFrame: toFrameCount(raw.startFrame, 0),
    durationFrames,
    sourceStartFrame: toFrameCount(raw.sourceStartFrame, 0),
    sourceDurationFrames: toFrameCount(raw.sourceDurationFrames, durationFrames),
  }
  // An effect list that is not a list carries nothing usable; dropping the
  // field is kinder than making every reader re-check it.
  if (effects === undefined) delete clip.effects
  else clip.effects = effects
  // `assetFrames` is a length the build trusts to bound trims, so it is kept
  // only when it is a real length. A NaN, a negative, a zero or a string from
  // a hand-edited file is dropped, and the clip falls back to the legacy
  // window limits rather than trimming against nonsense (PV-T5-1).
  if (!isPositiveFinite(clip.assetFrames)) delete clip.assetFrames
  else clip.assetFrames = Math.round(clip.assetFrames)
  // Merged A/V: the flag only means anything on a video clip, and a stray
  // `true` on an audio clip would make the resolver emit that clip's sound
  // twice. Dropped at the door rather than defended downstream.
  if (typeof clip.embeddedAudio !== 'boolean' || clip.type !== 'video') delete clip.embeddedAudio
  // Clip audio settings: clamped, or dropped when malformed or empty.
  const audio = readClipAudio(clip.audio, clip.type)
  if (audio) clip.audio = audio
  else delete clip.audio
  // `readClip` spreads the raw clip, so `raw.compound` is already sitting on
  // the clip unvalidated; the validated result replaces it (PV-P1).
  if (clip.type === 'compound') clip.compound = readCompound(raw.compound, clip.id, depth, fps)
  // EG-P1 provenance. Also spread through unvalidated above, so a malformed
  // value is dropped here, quietly, and never fails the clip.
  if (typeof clip.partId !== 'string' || clip.partId.length === 0 || clip.partId.length > MAX_PART_ID_LENGTH) delete clip.partId
  if (clip.component !== undefined && !isComponentInstance(clip.component)) delete clip.component
  if (clip.scene !== undefined && !isSceneSource(clip.scene)) delete clip.scene
  // MC-1d painter fields. `readClip` spreads the raw clip, so these ride through
  // unchanged; a malformed value is dropped here rather than left for every
  // painter to re-check (a bad shadow would otherwise throw mid-frame).
  if (clip.shadow !== undefined && !isClipShadow(clip.shadow)) delete clip.shadow
  if (clip.cornerRadii !== undefined && !isCornerRadii(clip.cornerRadii)) delete clip.cornerRadii
  if (clip.textDecoration !== undefined && clip.textDecoration !== 'underline' && clip.textDecoration !== 'line-through') {
    delete clip.textDecoration
  }
  // LM-P1 local-file reference: media clip types only, validated or dropped.
  if (clip.media !== undefined) {
    const media = MEDIA_CLIP_TYPES.has(clip.type) ? readClipMedia(clip.media) : null
    if (media) clip.media = media
    else delete clip.media
  }
  return clip
}

/**
 * A compound's nested timeline, read with every rule the root gets (PV-P1).
 * Refused, not dropped: a compound without its timeline has nothing to show,
 * and one nested too deep is a document this build cannot draw.
 */
function readCompound(raw: unknown, clipId: string, depth: number, fps: number): ClipCompound {
  if (!isPlainObject(raw) || !isPlainObject(raw.project)) {
    unreadable(`compound clip "${clipId}" has no nested timeline`)
  }
  if (depth + 1 > MAX_COMPOUND_DEPTH) {
    unreadable(`compound clip "${clipId}" is nested deeper than ${MAX_COMPOUND_DEPTH} levels`)
  }
  // A nested project written without its own fps inherits the parent's; one
  // with a different fps is forced to it (child fps = parent fps, PV-P1).
  const project = readProjectAt({ fps, ...(raw.project as object) }, undefined, depth + 1)
  return { project: project.fps === fps ? project : { ...project, fps } }
}

/**
 * The effect stack, keeping every well-formed entry — including kinds this
 * build does not know, which a newer build may, and which the resolver simply
 * treats as disabled. Only entries nothing could ever use are dropped: not an
 * object, no id, no kind, or params that are not an object.
 */
function readEffects(raw: unknown): Effect[] | undefined {
  if (raw === undefined || raw === null || !Array.isArray(raw)) return undefined
  const out: Effect[] = []
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue
    if (typeof entry.id !== 'string' || entry.id.length === 0) continue
    if (typeof entry.kind !== 'string' || entry.kind.length === 0) continue
    if (!isPlainObject(entry.params)) continue
    out.push(entry as unknown as Effect)
  }
  return out
}

/** An unusable in/out range is dropped: the whole timeline is the range. */
function readInOut(raw: unknown): InOutRange | null {
  if (!isPlainObject(raw)) return null
  if (typeof raw.in !== 'number' || typeof raw.out !== 'number') return null
  if (!Number.isFinite(raw.in) || !Number.isFinite(raw.out)) return null
  const start = toFrameCount(raw.in, 0)
  const end = toFrameCount(raw.out, 0)
  return end > start ? { in: start, out: end } : null
}

/** A marker is dropped, never refused, when it cannot be placed. */
function readMarker(raw: unknown): Marker | null {
  if (!isPlainObject(raw)) return null
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  if (typeof raw.frame !== 'number' || !Number.isFinite(raw.frame)) return null
  const marker: Marker = {
    id: raw.id,
    frame: toFrameCount(raw.frame, 0),
    name: typeof raw.name === 'string' ? raw.name : '',
  }
  if (isPositiveFinite(raw.durationFrames)) marker.durationFrames = Math.round(raw.durationFrames)
  if (typeof raw.color === 'string') marker.color = raw.color
  if (raw.kind === 'marker' || raw.kind === 'chapter' || raw.kind === 'beat') marker.kind = raw.kind
  return marker
}

/** An envelope string, kept only when it is valid base64 (padding included). */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/** Finite numbers → round, keep ≥ 0, sorted unique. Non-arrays → `[]`. */
function readFrameList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const out = new Set<number>()
  for (const value of raw) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const rounded = Math.round(value)
    if (rounded < 0) continue
    out.add(rounded)
  }
  return Array.from(out).sort((a, b) => a - b)
}

/**
 * Two-element numeric arrays → `[round(max(0, a)), round(b)]`; keep `end > start`;
 * sorted by start.
 */
function readFrameRanges(raw: unknown): Array<[number, number]> {
  if (!Array.isArray(raw)) return []
  const out: Array<[number, number]> = []
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) continue
    const [a, b] = entry
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) continue
    const start = Math.round(Math.max(0, a))
    const end = Math.round(b)
    if (end > start) out.push([start, end])
  }
  return out.sort((x, y) => x[0] - y[0])
}

/**
 * An audio analysis summary (PV-P10b), dropped without a non-empty string
 * `src`, a positive finite `fps`, or an integer `version` ≥ 1. `bpm` is kept
 * only when positive finite; `envelopes` only when an object whose four keys
 * are strings matching {@link BASE64} — otherwise omitted, keeping the rest
 * of the set.
 */
function readAudioMarkerSet(raw: unknown): AudioMarkerSet | null {
  if (!isPlainObject(raw)) return null
  if (typeof raw.src !== 'string' || raw.src.length === 0) return null
  if (!isPositiveFinite(raw.fps)) return null
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) return null

  const set: AudioMarkerSet = {
    src: raw.src,
    fps: raw.fps,
    version: raw.version,
    beats: readFrameList(raw.beats),
    silences: readFrameRanges(raw.silences),
  }
  if (isPositiveFinite(raw.bpm)) set.bpm = raw.bpm

  const envelopes = raw.envelopes
  if (
    isPlainObject(envelopes) &&
    typeof envelopes.level === 'string' &&
    BASE64.test(envelopes.level) &&
    typeof envelopes.low === 'string' &&
    BASE64.test(envelopes.low) &&
    typeof envelopes.mid === 'string' &&
    BASE64.test(envelopes.mid) &&
    typeof envelopes.high === 'string' &&
    BASE64.test(envelopes.high)
  ) {
    set.envelopes = { level: envelopes.level, low: envelopes.low, mid: envelopes.mid, high: envelopes.high }
  }
  return set
}

/**
 * A transition is dropped rather than refused when it no longer makes sense.
 *
 * It joins two clips; if either is gone, or this build has no renderer for its
 * kind, there is nothing to draw between them and nothing of the user's is
 * lost — the clips themselves are untouched. Refusing the whole document over
 * a decoration would be the disproportionate answer.
 */
function readTransition(raw: unknown, clipIds: ReadonlySet<string>): Transition | null {
  if (!isPlainObject(raw)) return null
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  if (typeof raw.trackId !== 'string') return null
  if (typeof raw.kind !== 'string' || !TRANSITION_KINDS.has(raw.kind)) return null
  if (typeof raw.fromClipId !== 'string' || typeof raw.toClipId !== 'string') return null
  if (!clipIds.has(raw.fromClipId) || !clipIds.has(raw.toClipId)) return null

  return {
    ...(raw as unknown as Transition),
    startFrame: toFrameCount(raw.startFrame, 0),
    // The engine keeps transition lengths even so the cut sits on a frame.
    durationFrames: Math.max(2, toFrameCount(raw.durationFrames, 2)),
  }
}

/**
 * A stored `ProjectComposition` (PV-P7): kept exactly what is valid, dropped
 * the rest. A binding's clip is never checked against this document's clips —
 * `instantiate` (PV-P7a-2) is where a stale or into-a-compound binding is
 * reported; dropping it here would erase the user's intent for a clip this
 * reader simply cannot see from where it stands.
 */
function readComposition(raw: unknown): ProjectComposition | null {
  if (!isPlainObject(raw)) return null

  const props: PropDef[] = []
  const seenNames = new Set<string>()
  if (Array.isArray(raw.props)) {
    for (const entry of raw.props) {
      if (!isPlainObject(entry)) continue
      if (typeof entry.name !== 'string' || !PROP_NAME_RE.test(entry.name) || seenNames.has(entry.name)) continue
      if (typeof entry.type !== 'string' || !PROP_TYPES.includes(entry.type as PropType)) continue
      const type = entry.type as PropType
      const options =
        Array.isArray(entry.options) && entry.options.every((o): o is string => typeof o === 'string')
          ? (entry.options as string[])
          : undefined
      if (type === 'enum' && (!options || options.length === 0)) continue

      const def: PropDef = {
        name: entry.name,
        type,
        label: typeof entry.label === 'string' ? entry.label : entry.name,
        default: '',
      }
      if (typeof entry.min === 'number' && Number.isFinite(entry.min)) def.min = entry.min
      if (typeof entry.max === 'number' && Number.isFinite(entry.max)) def.max = entry.max
      if (typeof entry.step === 'number' && Number.isFinite(entry.step)) def.step = entry.step
      if (entry.integer === true) def.integer = true
      if (options) def.options = options
      if (typeof entry.maxLength === 'number' && Number.isInteger(entry.maxLength) && entry.maxLength > 0) {
        def.maxLength = entry.maxLength
      }
      if (typeof entry.unit === 'string') def.unit = entry.unit
      if (typeof entry.description === 'string') def.description = entry.description

      const coercedDefault = coerceProp(def, entry.default)
      def.default = coercedDefault.value ?? fallbackValue(def)

      seenNames.add(def.name)
      props.push(def)
    }
  }
  if (props.length === 0) return null

  const propByName = new Map(props.map((p) => [p.name, p]))

  const bindings: Binding[] = []
  if (Array.isArray(raw.bindings)) {
    for (const entry of raw.bindings) {
      if (!isPlainObject(entry)) continue
      if (typeof entry.clipId !== 'string' || parseClipPath(entry.clipId) === null) continue
      if (typeof entry.path !== 'string' || parseFieldPath(entry.path) === null) continue
      if (typeof entry.prop !== 'string' || !propByName.has(entry.prop)) continue
      const binding: Binding = { clipId: entry.clipId, path: entry.path, prop: entry.prop }
      if (typeof entry.template === 'string') binding.template = entry.template
      bindings.push(binding)
    }
  }

  let values: Record<string, PropValue> | undefined
  if (isPlainObject(raw.values)) {
    const kept: Record<string, PropValue> = {}
    for (const [key, val] of Object.entries(raw.values)) {
      const def = propByName.get(key)
      if (!def) continue
      const r = coerceProp(def, val)
      if (r.value === undefined || r.issue?.severity === 'error') continue
      kept[key] = r.value
    }
    if (Object.keys(kept).length > 0) values = kept
  }

  const composition: ProjectComposition = { props, bindings }
  if (values) composition.values = values
  return composition
}

export interface ReadProjectDocumentOptions {
  /** Height given to a track whose stored height is missing or nonsense. */
  defaultTrackHeight?: number
}

/**
 * Turn a stored document into a `Project` the engine can be handed.
 *
 * Total: it either returns a project every consumer can dereference, or throws
 * {@link ProjectDocumentError}. It never returns something half-read.
 *
 * @throws {ProjectDocumentError}
 */
export function readProjectDocument(
  document: unknown,
  options?: ReadProjectDocumentOptions,
): Project {
  return readProjectAt(document, options, 0)
}

/**
 * The reader, with the nesting depth it is at. A compound's nested project is
 * read by calling this again one level down (PV-P1); the exported signature
 * stays as it was so no caller has to know about depth.
 */
function readProjectAt(
  document: unknown,
  options: ReadProjectDocumentOptions | undefined,
  depth: number,
): Project {
  if (!isPlainObject(document)) unreadable('it is not an object')

  const version = readVersion(document.version)

  if (!isPositiveFinite(document.fps)) unreadable('it has no frame rate')
  // Computed once, because a nested project is forced to the parent's fps and
  // every compound below it needs the same number.
  const fps = Math.max(1, Math.round(document.fps))
  if (!Array.isArray(document.tracks)) unreadable('it has no list of tracks')
  // `clips` is indexed by track id. An array would pass a `typeof` check and
  // then read as `undefined` for every track — an empty editor with no error.
  if (!isPlainObject(document.clips)) unreadable('its clips are not indexed by track')

  const defaultTrackHeight = options?.defaultTrackHeight ?? 64
  const tracks = keepOneMainTrack(document.tracks.map((raw, index) => readTrack(raw, index, defaultTrackHeight)))

  const seen = new Set<string>()
  for (const track of tracks) {
    if (seen.has(track.id)) unreadable(`two tracks share the id "${track.id}"`)
    seen.add(track.id)
  }

  const clips: Project['clips'] = {}
  for (const track of tracks) {
    const raw = (document.clips as Record<string, unknown>)[track.id]
    if (raw === undefined || raw === null) {
      // Every track indexes into `clips`, so an absent bucket is an empty one.
      clips[track.id] = []
      continue
    }
    if (!Array.isArray(raw)) unreadable(`the clips on track "${track.id}" are not a list`)
    clips[track.id] = raw
      .map((clip, index) => readClip(clip, track.id, index, depth, fps))
      .sort((a, b) => a.startFrame - b.startFrame)
  }
  // Buckets keyed by a track that no longer exists are dropped rather than
  // carried: nothing renders them, but `getTotalFrames` walks every bucket, so
  // they would stretch the timeline to a length with nothing in it.

  const clipIds = new Set<string>()
  for (const bucket of Object.values(clips)) for (const clip of bucket) clipIds.add(clip.id)

  const transitions: Transition[] = Array.isArray(document.transitions)
    ? document.transitions
        .map((raw) => readTransition(raw, clipIds))
        .filter((t): t is Transition => t !== null)
    : []

  const rawStage = document.stage
  const stage =
    isPlainObject(rawStage) && isPositiveFinite(rawStage.width) && isPositiveFinite(rawStage.height)
      ? { width: rawStage.width, height: rawStage.height }
      : { ...DEFAULT_STAGE }

  const project: Project = {
    id: typeof document.id === 'string' && document.id.length > 0 ? document.id : 'restored',
    fps: Math.max(1, Math.round(document.fps)),
    stage,
    tracks,
    clips,
    transitions,
    version,
    ...(document.masterVolume === undefined || document.masterVolume === null
      ? {}
      : { masterVolume: toGain(document.masterVolume, 1) }),
    ...(Array.isArray(document.markers)
      ? {
          markers: document.markers
            .map(readMarker)
            .filter((m): m is Marker => m !== null)
            .sort((a, b) => a.frame - b.frame),
        }
      : {}),
    ...(readInOut(document.inOut) ? { inOut: readInOut(document.inOut)! } : {}),
    // PV-T1. `'free'` is what absence means, so only `'magnetic'` is carried.
    ...(document.timelineMode === 'magnetic' ? { timelineMode: 'magnetic' as const } : {}),
  }
  const trackGroups = readTrackGroups(document.trackGroups, seen)
  if (trackGroups) project.trackGroups = trackGroups

  const composition = readComposition(document.composition)
  if (composition) project.composition = composition

  // PV-P10b: keep the LAST set per src (a later analysis replaces an earlier
  // one written for the same source). Optional field, so no version bump.
  if (Array.isArray(document.audioMarkers)) {
    const bySrc = new Map<string, AudioMarkerSet>()
    for (const entry of document.audioMarkers) {
      const set = readAudioMarkerSet(entry)
      if (set) bySrc.set(set.src, set)
    }
    if (bySrc.size > 0) project.audioMarkers = Array.from(bySrc.values())
  }

  // EG-P1: the authored document behind a generated piece. Optional, never
  // read by the renderer, so no version bump.
  const authored = readAuthored(document.authored)
  if (authored) project.authored = authored

  // PQ-2c: the style kit id. Optional, never read by the renderer, so no version bump. An unknown id is kept.
  if (typeof document.styleKit === 'string' && document.styleKit.length >= 1 && document.styleKit.length <= 40) {
    project.styleKit = document.styleKit
  }

  return migrate(project, version)
}

/**
 * Whether {@link readProjectDocument} would accept this document, without the
 * throw. For deciding what to *show*; the restore path should call
 * `readProjectDocument` itself and use what it returns.
 */
export function isReadableProjectDocument(document: unknown): boolean {
  try {
    readProjectDocument(document)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/** Clip types that play from a source file. */
export type MediaClipType = 'video' | 'audio' | 'image' | 'sequence'

export const MEDIA_CLIP_TYPES: ReadonlySet<string> = new Set<MediaClipType>(['video', 'audio', 'image', 'sequence'])

/**
 * Whether a stored `src` can be fetched again in a *later* session.
 *
 * `blob:` and `data:` URLs are the ones that cannot. They are minted by
 * `URL.createObjectURL` when a user imports a file from their device, they are
 * baked into the clip, and they die with the document that created them — so a
 * project saved with one comes back tomorrow pointing at nothing. Naming that
 * case here is what lets the editor tell the user which clips need their file
 * again instead of showing them a black rectangle and no explanation.
 */
export function isRecoverableMediaSrc(src: string | undefined): src is string {
  if (typeof src !== 'string' || src.length === 0) return false
  if (src.startsWith('blob:') || src.startsWith('data:')) return false
  return true
}

/** A clip whose source file cannot be fetched again. */
export interface MissingMedia {
  clipId: string
  clipName: string
  kind: MediaClipType
  /**
   * `'reconnectable'`: the clip carries a local-file reference (`clip.media`),
   * so the file can be found again; `'gone'`: nothing to find it by (LM-P1).
   */
  reason: 'gone' | 'reconnectable'
  /** The `clip.media.id` to reconnect by; present with `'reconnectable'`. */
  mediaId?: string
}

/** Options for {@link relinkProjectMedia}. */
export interface RelinkMediaOptions {
  /**
   * Fresh sources for local files, by `ClipMediaRef.id` (LM-P1): the object
   * URLs minted from handles after a reload. A clip whose `media.id` is here
   * gets its `src` replaced (and `project.audioMarkers` follow) and is not
   * reported missing.
   */
  remint?: ReadonlyMap<string, string>
}

export interface RelinkMediaResult {
  /**
   * The composition with every resolvable `assetId` pointing at the library.
   * The same object reference as the input when nothing needed changing, so a
   * caller can use identity to tell whether anything moved.
   */
  project: Project
  /** How many clips had their library reference repaired. */
  relinked: number
  /** Clips that came back without a usable source file. Never dropped. */
  missing: MissingMedia[]
}

/**
 * Point restored clips back at the media library.
 *
 * A clip carries both a `src` (what the renderer plays) and an `assetId` (what
 * the timeline reads its filmstrip and intrinsic size from). Only `src`
 * survives a save — the library is rebuilt from scratch on every page load and
 * hands out fresh ids — so a restored clip's `assetId` names an asset that no
 * longer exists. The composition still *plays*, because `resolveTimeline` reads
 * `src` and never `assetId`; what breaks is cosmetic and silent: no filmstrip
 * on the clip, and a selection box that falls back to the whole stage.
 *
 * So the repair is a match on `src` against whatever the library holds. It is
 * pure — the caller decides when to apply it — because the library is filled
 * asynchronously after the composition is already on screen.
 *
 * Clips whose media cannot be recovered at all are reported in `missing` and
 * left exactly where they are, with their name, position and length intact.
 * Dropping them would be the one outcome the user can neither see nor undo.
 */
export function relinkProjectMedia(
  project: Project,
  assets: Iterable<{ id: string; src: string }>,
  opts?: RelinkMediaOptions,
): RelinkMediaResult {
  const remint = opts?.remint
  const bySrc = new Map<string, string>()
  const knownIds = new Set<string>()
  for (const asset of assets) {
    knownIds.add(asset.id)
    if (!bySrc.has(asset.src)) bySrc.set(asset.src, asset.id)
  }

  const missing: MissingMedia[] = []
  let relinked = 0

  const relinkLevel = (level: Project, depth: number): Project => {
    /** Old src -> fresh src, for the beat markers keyed by it. */
    const remapped = new Map<string, string>()
    const nextClips: Project['clips'] = {}
    let changed = false

    for (const [trackId, bucket] of Object.entries(level.clips)) {
      let bucketChanged = false
      const nextBucket = bucket.map((original) => {
        let clip = original
        // LM-P3: a compound's own clips are media clips too; the same repair
        // runs inside it, to the depth the reader accepts.
        if (clip.type === 'compound' && clip.compound) {
          if (depth + 1 > MAX_COMPOUND_DEPTH) return clip
          const inner = relinkLevel(clip.compound.project, depth + 1)
          if (inner === clip.compound.project) return clip
          bucketChanged = true
          return { ...clip, compound: { ...clip.compound, project: inner } }
        }
        if (!MEDIA_CLIP_TYPES.has(clip.type)) return clip
        // A `frames` sequence has no `src` at all — its per-frame URLs are the
        // template, not a library asset — so it is left out of both `missing`
        // and the relink match rather than reported as broken media.
        if (clip.type === 'sequence' && clip.sequence?.kind !== 'animated-image') return clip

        // LM-P1: a local file the caller has re-opened gets its fresh object URL.
        const fresh = clip.media && remint ? remint.get(clip.media.id) : undefined
        if (typeof fresh === 'string' && fresh.length > 0) {
          if (fresh !== clip.src) {
            if (clip.src) remapped.set(clip.src, fresh)
            clip = { ...clip, src: fresh }
            bucketChanged = true
          }
        } else if (!isRecoverableMediaSrc(clip.src)) {
          missing.push({
            clipId: clip.id,
            clipName: clip.name,
            kind: clip.type as MediaClipType,
            reason: clip.media ? 'reconnectable' : 'gone',
            ...(clip.media ? { mediaId: clip.media.id } : {}),
          })
          return clip
        }

        // Already pointing at something real — leave it alone.
        if (clip.assetId !== undefined && knownIds.has(clip.assetId)) return clip

        const assetId = bySrc.get(clip.src!)
        if (assetId === undefined || assetId === clip.assetId) return clip

        relinked++
        bucketChanged = true
        return { ...clip, assetId }
      })

      nextClips[trackId] = bucketChanged ? nextBucket : bucket
      if (bucketChanged) changed = true
    }

    if (!changed) return level

    const next: Project = { ...level, clips: nextClips }
    // Beat markers are keyed by the src they were analysed from (PV-P10b); a
    // re-minted clip would otherwise lose them to its new object URL (LM-P1).
    if (remapped.size > 0 && level.audioMarkers) {
      next.audioMarkers = level.audioMarkers.map((set) => {
        const to = remapped.get(set.src)
        return to === undefined ? set : { ...set, src: to }
      })
    }
    return next
  }

  const next = relinkLevel(project, 0)
  return { project: next, relinked, missing }
}

/**
 * One line naming the clips whose media did not come back.
 *
 * Lives here rather than in the editor because the *rule* — name up to two,
 * count the rest — is what keeps the message readable on a project with thirty
 * broken clips, and that rule is worth a test. The caller supplies the frame
 * around it.
 */
export function missingMediaSummary(missing: readonly MissingMedia[]): string | null {
  if (missing.length === 0) return null
  const names = missing.map((m) => m.clipName)
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`
}
