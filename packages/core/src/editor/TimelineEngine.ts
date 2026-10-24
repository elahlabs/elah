import { produce, type Draft } from 'immer'
import { hasTimeRemap, sourceFramesAvailable } from '../resolver/sourceTime'
import { documentVersionFor } from './projectDocument'
import type {
  AudioMarkerSet,
  Clip,
  ClipComponentInstance,
  EngineEvent,
  EngineEventPayload,
  InOutRange,
  InitialTrackConfig,
  LoadProjectHistory,
  LoadProjectTransport,
  Marker,
  Project,
  ProjectAuthored,
  TimelineConfig,
  TimelineMode,
  Track,
  TrackKind,
  Transition,
  TransitionKind,
  TransitionEasing,
  TransitionDirection,
} from '../types'
import type { ProjectComposition } from '../composition/types'
import { MAX_COMPOUND_DEPTH } from '../types'
import {
  placeClipsInDraft,
  PlacementRejected,
  type ClipPlacement,
  type PlaceOptions,
  type PlacementFailure,
} from '../visitor/place'
import { resolveMainTrackId } from '../actions/placement'
import { generateId } from '../utils/id'
import { getTotalFrames, toFrame, findOverlaps } from '../utils/frames'
import { createTrack, type CreateTrackOptions } from '../track/track'
import { createClip, type CreateClipOptions } from '../elements/base'
import {
  nestProject,
  unnestProject,
  type CompoundEditResult,
  type NestOptions,
} from '../elements/compound'
import { addClip } from '../visitor/add'
import { removeClip, removeTrack, pruneOrphanedTransitions } from '../visitor/remove'
import { updateClip, updateTrack } from '../visitor/update'
import { splitClip } from '../visitor/split'
import { cloneClip } from '../visitor/clone'
import { remapKeyframes } from '../resolver/keyframes'
import { planCaptionRetime } from '../actions/retimeCaptions'

/**
 * A history entry stores the project snapshot before and after a mutation.
 * Because Immer produces structurally-shared objects, only changed nodes
 * allocate new memory — unchanged subtrees are shared by reference.
 * This makes history storage O(diff) not O(project size).
 */
interface HistoryEntry {
  prev: Project
  next: Project
  description: string
}

type Listener<E extends EngineEvent> = (payload: EngineEventPayload[E]) => void

// ---------------------------------------------------------------------------
// Compound child-project commits (PV-P1c-1)
// ---------------------------------------------------------------------------

/**
 * Why a `updateCompoundProject` was refused.
 *
 * Separate from `CompoundEditErrorCode` (in `elements/compound.ts`, which this
 * ticket does not own) because these are the CHILD-EDIT refusals: a session
 * handing back a project it may have been editing against a document that moved
 * under it while the modal was open.
 */
export type UpdateCompoundErrorCode =
  | 'clip-not-found'
  | 'not-a-compound'
  | 'track-locked'
  | 'track-disabled'
  | 'fps-mismatch'
  | 'too-deep'
  | 'stale-child'
  | 'no-component'

export type UpdateCompoundResult =
  | { ok: true; data: { clipId: string } }
  | { ok: false; error: { code: UpdateCompoundErrorCode; message: string } }

function compoundUpdateFailure(code: UpdateCompoundErrorCode, message: string): UpdateCompoundResult {
  return { ok: false, error: { code, message } }
}

/**
 * Every clip id in `project` with the number of compound ancestors behind it.
 *
 * One pass rather than a per-clip upward walk, because the upward version is
 * O(clips x depth) and rebuilds an id map at every level, and this runs on the
 * save path where the document may already be large. Bounded by
 * `MAX_COMPOUND_DEPTH`, so a hand-built or malformed document cannot spin here.
 */
function compoundDepths(project: Project): Map<string, number> {
  const out = new Map<string, number>()
  const visit = (p: Project, depth: number) => {
    for (const clips of Object.values(p.clips)) {
      for (const clip of clips) {
        // A repeated id would otherwise be visited once per parent and the
        // shallowest depth would win, which is the wrong answer for a duplicate.
        if (out.has(clip.id)) continue
        out.set(clip.id, depth)
        if (depth < MAX_COMPOUND_DEPTH && clip.type === 'compound' && clip.compound) {
          visit(clip.compound.project, depth + 1)
        }
      }
    }
  }
  visit(project, 0)
  return out
}

/** The deepest compound nesting inside `project`; 0 when it holds no compounds. */
function deepestCompoundChain(project: Project): number {
  let deepest = 0
  for (const depth of compoundDepths(project).values()) if (depth > deepest) deepest = depth
  return deepest
}

/**
 * Structural equality for a whole project, key-order independent.
 *
 * Decides whether a compound changed while a child editor was open. NOT a
 * reference compare: the session's snapshot is immutable while the engine's copy
 * is a fresh immer object after every commit, so identity carries no information.
 * Key order is normalised because two structurally identical projects built by
 * different routes can serialise a map in a different order.
 */
function sameProject(a: Project, b: Project): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

/** What `placeClips` did (PV-T1). */
export interface PlaceClipsResult {
  ok: boolean
  /** Why nothing changed, when `ok` is false. */
  reason?: PlacementFailure
  /** The clips as placed, in `moves` order: the originals for a move, the new copies for a copy. */
  clipIds: string[]
}

/** What `rippleMain` did (PV-T1). */
export interface RippleMainResult {
  ok: boolean
  /** True when overlay clips moved with the main track, false when only the main track did. */
  linked: boolean
}

function placementDescription(count: number, options: PlaceOptions): string {
  const noun = count === 1 ? 'clip' : 'clips'
  if (options.copy) return `Duplicate ${noun}`
  if (options.mode === 'insert') return `Insert ${noun}`
  if (options.mode === 'overwrite') return `Overwrite with ${noun}`
  return `Move ${noun}`
}

/** Drop a `linkId` left on a single clip: a group of one links nothing. */
function dissolveLonelyLinks(draft: Draft<Project>, linkIds: ReadonlySet<string>): void {
  if (linkIds.size === 0) return
  const members = new Map<string, Draft<Clip>[]>()
  for (const list of Object.values(draft.clips)) {
    for (const c of list) {
      if (c.linkId && linkIds.has(c.linkId)) {
        const group = members.get(c.linkId) ?? []
        group.push(c)
        members.set(c.linkId, group)
      }
    }
  }
  for (const group of members.values()) {
    if (group.length === 1) delete group[0]!.linkId
  }
}

function buildEmptyProject(
  fps: number,
  stage: { width: number; height: number },
  initialTracks: InitialTrackConfig[] | undefined,
  defaultTrackHeight: number,
): Project {
  // Fallback on absence only: `undefined` keeps the legacy single lane, `[]` means zero tracks.
  const specs: InitialTrackConfig[] = initialTracks ?? [{ kind: 'video', name: 'Track 1' }]

  const tracks = specs.map((spec, order) =>
    createTrack({
      kind: spec.kind,
      name: spec.name,
      order,
      height: spec.height ?? defaultTrackHeight,
      protected: spec.protected,
      pinned: spec.pinned,
    }),
  )

  // Initialize an empty clip array per track so consumers can index `clips[id]`
  // without an undefined check on a brand-new project.
  const clips: Project['clips'] = {}
  for (const track of tracks) clips[track.id] = []

  return {
    id: generateId(),
    fps,
    stage,
    tracks,
    clips,
    transitions: [],
    version: 1,
  }
}

/**
 * TimelineEngine
 *
 * The single source of truth for timeline project state.
 * All mutations go through this class — it applies them via Immer (structural
 * sharing), records history entries for undo/redo, and emits typed events so
 * React stores (or any other subscriber) can stay in sync.
 *
 * Zero React dependency — works in Node.js, Svelte, Vue, or vanilla JS.
 *
 * @example
 * ```ts
 * const engine = new TimelineEngine({ fps: 30 })
 * const track = engine.addTrack('video')
 * engine.addClip({ trackId: track.id, type: 'video', startFrame: 0, durationFrames: 90 })
 * engine.undo()
 * ```
 */
export class TimelineEngine {
  private project: Project
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private readonly maxHistorySize: number
  private readonly defaultTrackHeight: number

  // Transaction state for batch(). When batchDepth > 0, commit() applies
  // mutations to this.project as usual (so subsequent queries see fresh state)
  // but defers the history entry + 'change' / 'history:change' emits until the
  // outermost batch closes. One batch = one undo entry.
  private batchDepth = 0
  /** See `getRevision`. */
  private _revision = 0
  private batchPrev: Project | null = null
  private batchDescription: string | null = null

  // Snapshot of the project taken when an interactive gesture (previewClip)
  // begins, so commitInteraction() can record one undo entry for the whole drag.
  private interactionPrev: Project | null = null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private listeners = new Map<EngineEvent, Set<(payload: any) => void>>()

  constructor(config: TimelineConfig) {
    const stage = config.stage ?? { width: 1080, height: 1920 }
    this.maxHistorySize = config.maxHistorySize ?? 100
    this.defaultTrackHeight = config.defaultTrackHeight ?? 64
    this.project = buildEmptyProject(
      config.fps,
      stage,
      config.initialTracks,
      this.defaultTrackHeight,
    )
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** Returns an immutable snapshot that is replaced on every commit — re-read after edits, never mutate it. */
  getProject(): Project {
    return this.project
  }

  /** Returns undefined for unknown ids — callers decide whether a missing track is an error. */
  getTrack(trackId: string): Track | undefined {
    return this.project.tracks.find((t) => t.id === trackId)
  }

  /** Always sorted by startFrame; returns [] for unknown tracks so callers can iterate without guarding. */
  getClipsOnTrack(trackId: string): Clip[] {
    return this.project.clips[trackId] ?? []
  }

  /** Scans every track for a clip by id alone — use when the caller doesn't know which track holds it. */
  findClip(clipId: string): { clip: Clip; trackId: string } | null {
    for (const [trackId, clips] of Object.entries(this.project.clips)) {
      const clip = clips.find((c) => c.id === clipId)
      if (clip) return { clip, trackId }
    }
    return null
  }

  /** Effective timeline length: the frame where the last clip on any track ends, not a configured value. */
  getTotalFrames(): number {
    return getTotalFrames(this.project.clips)
  }

  /** History is capped, so the oldest edits eventually stop being undoable; track via 'history:change' rather than polling. */
  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  /** Any new edit after an undo clears the redo stack, flipping this back to false. */
  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  // ---------------------------------------------------------------------------
  // Project operations
  // ---------------------------------------------------------------------------

  /**
   * Set the output canvas (stage) dimensions, e.g. switching aspect ratio.
   * Recorded as one undo entry. Clips re-fit to the new stage on the next
   * resolve (no per-clip migration needed — placement is normalized).
   */
  setStage(width: number, height: number): void {
    this.commit((draft) => {
      draft.stage = { width, height }
    }, 'Change aspect ratio')
  }

  /** Set the project-level master volume (linear, 0..2). Persisted with the project. */
  setMasterVolume(value: number): void {
    this.commit((draft) => {
      draft.masterVolume = Math.max(0, Math.min(2, value))
    }, 'Set master volume')
  }

  // ---------------------------------------------------------------------------
  // Markers and in/out (EDX-P5)
  // ---------------------------------------------------------------------------

  /**
   * Add a marker at an absolute frame. One undo step. A second marker on the
   * same frame is allowed (chapters and beats can coincide with a note).
   */
  addMarker(frame: number, options: Partial<Omit<Marker, 'id' | 'frame'>> = {}): Marker {
    const marker: Marker = {
      id: generateId(),
      frame: Math.max(0, Math.round(Number.isFinite(frame) ? frame : 0)),
      name: options.name ?? '',
      ...(options.durationFrames && options.durationFrames > 0
        ? { durationFrames: Math.round(options.durationFrames) }
        : {}),
      ...(options.color ? { color: options.color } : {}),
      ...(options.kind ? { kind: options.kind } : {}),
    }
    this.commit((draft) => {
      const list = draft.markers ?? []
      list.push(marker)
      list.sort((a, b) => a.frame - b.frame)
      draft.markers = list
    }, 'Add marker')
    return marker
  }

  /** Rename, recolour or move a marker. Unknown ids are a no-op. */
  updateMarker(id: string, patch: Partial<Omit<Marker, 'id'>>): void {
    this.commit((draft) => {
      const m = draft.markers?.find((x) => x.id === id)
      if (!m) return
      if (patch.name !== undefined) m.name = patch.name
      if (patch.color !== undefined) m.color = patch.color
      if (patch.kind !== undefined) m.kind = patch.kind
      if (patch.frame !== undefined && Number.isFinite(patch.frame)) {
        m.frame = Math.max(0, Math.round(patch.frame))
        draft.markers!.sort((a, b) => a.frame - b.frame)
      }
      if (patch.durationFrames !== undefined) {
        if (patch.durationFrames > 0) m.durationFrames = Math.round(patch.durationFrames)
        else delete m.durationFrames
      }
    }, 'Edit marker')
  }

  removeMarker(id: string): void {
    this.commit((draft) => {
      if (!draft.markers) return
      const idx = draft.markers.findIndex((m) => m.id === id)
      if (idx === -1) return
      draft.markers.splice(idx, 1)
      if (draft.markers.length === 0) delete draft.markers
    }, 'Remove marker')
  }

  /**
   * Set or clear the in/out range. `out` is exclusive; a range with
   * `out <= in` clears it. Either end may be given alone to move just that
   * end (the other defaults to the timeline's start or end).
   */
  setInOut(range: Partial<InOutRange> | null): void {
    this.commit((draft) => {
      if (range === null) {
        delete draft.inOut
        return
      }
      const end = Math.max(1, getTotalFrames(this.project.clips))
      const current = draft.inOut
      const start = Math.max(0, Math.round(range.in ?? current?.in ?? 0))
      const stop = Math.max(0, Math.round(range.out ?? current?.out ?? end))
      if (stop <= start) {
        delete draft.inOut
        return
      }
      draft.inOut = { in: start, out: stop }
    }, range === null ? 'Clear in/out' : 'Set in/out')
  }

  // ---------------------------------------------------------------------------
  // Audio markers (PV-P10b)
  // ---------------------------------------------------------------------------

  /** Add or replace (by `src`) one source's analysis summary. One undo step. */
  setAudioMarkers(set: AudioMarkerSet): void {
    this.commit((draft) => {
      const list = (draft.audioMarkers ?? []).filter((s) => s.src !== set.src)
      list.push(set)
      draft.audioMarkers = list
    }, 'Detect beats')
  }

  /** Remove the summary for `src`; drops `audioMarkers` when it empties. Unknown src: no undo entry. */
  removeAudioMarkers(src: string): void {
    this.commit((draft) => {
      if (!draft.audioMarkers) return
      const list = draft.audioMarkers.filter((s) => s.src !== src)
      if (list.length === draft.audioMarkers.length) return
      if (list.length === 0) delete draft.audioMarkers
      else draft.audioMarkers = list
    }, 'Clear beats')
  }

  // ---------------------------------------------------------------------------
  // Track operations
  // ---------------------------------------------------------------------------

  /**
   * Track model: any number of tracks of any kind. Multiple video tracks
   * composite in track order - the resolver derives zIndex from `track.order`
   * (a higher order draws on top, and order 0 is the top lane in the UI, so
   * *lower* lanes composite over higher ones). Overlapping clips on separate
   * video tracks therefore layer rather than conflict.
   *
   * Placement: a new video track slots in directly below the last existing
   * video track (keeping video lanes grouped at the top, above audio/elements);
   * every other kind appends below all existing tracks.
   */
  addTrack(kind: TrackKind, options?: Partial<CreateTrackOptions>): Track {
    const videoOrders = this.project.tracks
      .filter((t) => t.kind === 'video')
      .map((t) => t.order)
    // Bottom-pinned lanes (audio + its generated subtitle lanes, in this
    // product) must stay below every freely-added track. A new pinned track
    // joins that block at the very end (today's plain-append behaviour); a
    // new non-pinned, non-video track inserts just above the block instead
    // of after it, which is the only way "add track" can land between video
    // and a bar that's meant to stay fixed at the bottom. No pinned tracks
    // means this is a no-op — same append-at-end behaviour as before.
    const pinnedOrders = this.project.tracks
      .filter((t) => t.pinned === 'bottom')
      .map((t) => t.order)
    const order =
      kind === 'video' && videoOrders.length > 0
        ? Math.max(...videoOrders) + 1
        : options?.pinned === 'bottom' || pinnedOrders.length === 0
          ? this.project.tracks.length
          : Math.min(...pinnedOrders)

    const track = createTrack({
      kind,
      order,
      height: this.defaultTrackHeight,
      ...options,
    })

    // TRK-2: one batch around the commit AND the event, so whatever a
    // `track:added` listener writes (the host styles the first lane of each
    // kind) lands in the same undo entry. Without it, an add from the toolbar
    // left two entries and Undo reverted the styling, not the track.
    this.batch(() => {
      this.commit(
        (draft) => {
          // Make room at the insertion point: everything at or below it shifts
          // down one slot. For plain appends nothing is >= tracks.length, so
          // this is a no-op.
          for (const t of draft.tracks) {
            if (t.order >= track.order) t.order += 1
          }
          draft.tracks.push(track as Draft<Track>)
          draft.tracks.sort((a, b) => a.order - b.order)
          draft.clips[track.id] = []
        },
        `Add ${kind} track`,
      )

      this.emit('track:added', track)
    }, `Add ${kind} track`)
    return track
  }

  /** Removes the track's clips with it, all in a single undo entry. No-op for protected tracks. */
  removeTrack(trackId: string): void {
    const track = this.project.tracks.find((t) => t.id === trackId)
    if (track?.protected) return

    this.commit(
      (draft) => removeTrack(draft, trackId),
      `Remove track`,
    )
    this.emit('track:removed', trackId)
  }

  /** Shallow-merges partial updates; for order changes prefer reorderTracks, which keeps all indices consistent. */
  updateTrack(trackId: string, updates: Partial<Track>): void {
    this.commit(
      (draft) => updateTrack(draft, trackId, updates),
      `Update track`,
    )
  }

  /** Expects the complete id list — tracks omitted from it keep stale order values. */
  reorderTracks(orderedIds: string[]): void {
    this.commit((draft) => {
      orderedIds.forEach((id, index) => {
        const track = draft.tracks.find((t) => t.id === id)
        if (track) track.order = index
      })
      draft.tracks.sort((a, b) => a.order - b.order)
    }, 'Reorder tracks')
  }

  // ---------------------------------------------------------------------------
  // Clip operations
  // ---------------------------------------------------------------------------

  /** Throws if the target track is missing or the clip would overlap an existing one — validate placement first. */
  /**
   * A track flagged `locked` rejects edits to existing clips — remove, move,
   * trim, split — enforced here on the single mutation funnel so every caller
   * (drag handles, keyboard, undo/redo callers) honors it uniformly. Inserting
   * NEW clips (drop / paste) is gated at the UI layer, leaving programmatic
   * `addClip` (demo setup, scripts) unrestricted. Visibility (`disabled`) and
   * `muted` are honored separately by the resolver.
   */
  isTrackLocked(trackId: string): boolean {
    return this.project.tracks.find((t) => t.id === trackId)?.locked ?? false
  }

  addClip(options: CreateClipOptions): Clip {
    const clip = createClip(options)

    this.commit(
      (draft) => {
        addClip(draft, clip)
      },
      `Add ${clip.type} clip`,
    )

    this.emit('clip:added', clip)
    return clip
  }

  /** Transitions referencing the removed clip are pruned in the same undo entry. */
  removeClip(clipId: string, trackId: string): void {
    if (this.isTrackLocked(trackId)) return
    this.commit(
      (draft) => removeClip(draft, clipId, trackId),
      `Remove clip`,
    )
    this.emit('clip:removed', { clipId, trackId })
  }

  /** Positional changes are validated against neighbouring clips and re-sort the track; undoable — use previewClip during gestures. */
  updateClip(clipId: string, trackId: string, updates: Partial<Clip>): void {
    this.commit(
      (draft) => updateClip(draft, clipId, trackId, updates),
      `Update clip`,
    )

    const clip = this.findClip(clipId)?.clip
    if (clip) this.emit('clip:updated', clip)
  }

  /**
   * Live, non-undoable clip mutation for interactive gestures (drag / resize on
   * the preview canvas). Applies immediately and emits 'change' so the preview
   * follows the pointer, but records NO history entry. Call commitInteraction()
   * when the gesture ends to fold every previewClip() since it began into a
   * single undo step. Without that final call the moves are still applied — they
   * just won't be individually undoable, which is the intended behaviour for the
   * intermediate frames of a drag.
   */
  previewClip(clipId: string, trackId: string, updates: Partial<Clip>): void {
    if (this.interactionPrev === null) this.interactionPrev = this.project

    const next = produce(this.project, (draft) =>
      updateClip(draft, clipId, trackId, updates),
    )
    if (next === this.project) return

    this.project = next
    this._revision++
    this.emit('change', this.project)
    this.emit('clip:updated', this.findClip(clipId)!.clip)
  }

  /**
   * Close an interaction opened by previewClip(), recording ONE history entry
   * spanning the gesture's start → current state. No-op when no preview ran or
   * the net change was empty (e.g. a click with no drag).
   */
  commitInteraction(description = 'Edit clip'): void {
    const prev = this.interactionPrev
    if (prev === null) return
    this.interactionPrev = null

    const next = this.project
    if (next === prev) return

    this.undoStack.push({ prev, next, description })
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift()
    }
    this.redoStack = []

    this.emit('history:change', {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    })
  }

  /**
   * Abandon an interaction opened by previewClip(), restoring the project to its
   * pre-gesture snapshot. Emits 'change' so the preview snaps back; records no
   * history. Used for the Escape-to-cancel path of inline text editing.
   */
  cancelInteraction(): void {
    const prev = this.interactionPrev
    if (prev === null) return
    this.interactionPrev = null
    if (this.project !== prev) {
      this.project = prev
      this._revision++
      this.emit('change', this.project)
    }
  }

  /**
   * Move a clip to a new position, optionally onto a different track.
   * Rejects silently (no history entry, no event) when the destination range
   * overlaps an existing clip on the target track.
   */
  moveClip(
    clipId: string,
    fromTrackId: string,
    toTrackId: string,
    startFrame: number,
  ): void {
    // A locked source or destination track rejects the move.
    if (this.isTrackLocked(fromTrackId) || this.isTrackLocked(toTrackId)) return

    const fromClips = this.project.clips[fromTrackId]
    if (!fromClips) return

    const clip = fromClips.find((c) => c.id === clipId)
    if (!clip) return

    const newStart = toFrame(startFrame)
    const candidate = { startFrame: newStart, durationFrames: clip.durationFrames }
    const destClips = this.project.clips[toTrackId] ?? []
    // Exclude the clip itself so same-track moves don't self-overlap
    if (findOverlaps(destClips, candidate, clipId).length > 0) return

    this.commit((draft) => {
      const fromClipsDraft = draft.clips[fromTrackId]
      if (!fromClipsDraft) return

      const idx = fromClipsDraft.findIndex((c) => c.id === clipId)
      if (idx === -1) return

      const [movedClip] = fromClipsDraft.splice(idx, 1)
      movedClip.startFrame = newStart
      movedClip.trackId = toTrackId

      if (!draft.clips[toTrackId]) draft.clips[toTrackId] = []
      draft.clips[toTrackId].push(movedClip)
      draft.clips[toTrackId].sort((a, b) => a.startFrame - b.startFrame)

      pruneOrphanedTransitions(draft)
    }, 'Move clip')
  }

  /**
   * Shift several clips along their own tracks in ONE commit (ripple edits).
   *
   * Validated against the final layout, not move by move: a sequence of
   * `moveClip` calls would briefly open gaps and `pruneOrphanedTransitions`
   * would drop transitions whose two clips both move. Transitions follow the
   * shift of their incoming clip. Returns false, changing nothing, when a
   * track is locked, a clip is unknown, a start would go negative, or the
   * result would overlap.
   */
  shiftClips(
    moves: ReadonlyArray<{ clipId: string; trackId: string; delta: number }>,
    description = 'Shift clips',
  ): boolean {
    const deltas = new Map<string, number>()
    const tracks = new Set<string>()
    for (const m of moves) {
      if (!Number.isFinite(m.delta)) return false
      if (this.isTrackLocked(m.trackId)) return false
      const clip = this.project.clips[m.trackId]?.find((c) => c.id === m.clipId)
      if (!clip) return false
      if (clip.startFrame + Math.round(m.delta) < 0) return false
      deltas.set(m.clipId, Math.round(m.delta))
      tracks.add(m.trackId)
    }
    if (deltas.size === 0 || [...deltas.values()].every((d) => d === 0)) return true

    for (const trackId of tracks) {
      const spans = (this.project.clips[trackId] ?? [])
        .map((c) => {
          const start = c.startFrame + (deltas.get(c.id) ?? 0)
          return { start, end: start + c.durationFrames }
        })
        .sort((a, b) => a.start - b.start)
      for (let i = 1; i < spans.length; i++) {
        if (spans[i]!.start < spans[i - 1]!.end) return false
      }
    }

    this.commit((draft) => {
      for (const trackId of tracks) {
        const list = draft.clips[trackId]
        if (!list) continue
        for (const c of list) {
          const d = deltas.get(c.id)
          if (d) c.startFrame += d
        }
        list.sort((a, b) => a.startFrame - b.startFrame)
      }
      for (const t of draft.transitions) {
        const d = deltas.get(t.toClipId)
        if (d) t.startFrame += d
      }
      pruneOrphanedTransitions(draft)
    }, description)
    return true
  }

  /**
   * Trim a clip's in/out points.
   * Adjusts both timeline position and source trim boundaries.
   *
   * Invariant: a clip's duration cannot exceed its source asset length
   * (sourceDurationFrames). Text clips have no source asset and may grow
   * freely. The cap is enforced here so every caller — drag handles,
   * keyboard shortcuts, scripts, undo/redo — honors it without repeating
   * the rule.
   *
   * Rejects silently (no history entry, no event) when the trimmed range
   * would overlap an existing clip on the same track, or when a left-extend
   * would reach beyond the source's available frames.
   */
  trimClip(
    clipId: string,
    trackId: string,
    startFrame: number,
    durationFrames: number,
  ): void {
    if (this.isTrackLocked(trackId)) return
    // Read from the current project snapshot so we can validate before committing.
    const trackClips = this.project.clips[trackId]
    const existing = trackClips?.find((c) => c.id === clipId)
    if (!existing) return

    // Clips without source media (text, still images, shapes, drawings,
    // adjustment and generator clips) may grow freely; the timeline's drag
    // preview already treated adjustment clips this way, so the commit now
    // agrees with it. A still image has no length of its own, so the window it
    // was inserted with is not a limit.
    const isUnlimited =
      existing.type === 'text' ||
      existing.type === 'image' ||
      existing.type === 'shape' ||
      existing.type === 'freehand' ||
      existing.type === 'adjustment' ||
      existing.type === 'generator' ||
      existing.type === 'sequence'
    // Every timeline frame of a speed-changed clip consumes `speed` source
    // frames, so the source-window invariant becomes durationFrames * speed
    // <= sourceDurationFrames. speed is always 1 for non-video clips (the UI
    // never sets it), so this is a no-op there.
    const speed = existing.speed ?? 1

    // The head first: how far the media's in-point moves decides how much of it
    // is left to play (PV-T5-1). Computing the cap after this is equivalent for
    // a legacy clip, whose `sourceFramesAvailable` ignores the start.
    // Generated clips (text, shape, freehand) have no source constraint and are
    // always allowed to grow left.
    const rawStart = Math.max(0, toFrame(startFrame))
    const minAllowedStart = isUnlimited
      ? 0
      : Math.max(0, existing.startFrame - Math.floor(existing.sourceStartFrame / speed))
    const newStart = Math.max(minAllowedStart, rawStart)

    // startDelta > 0 → left-edge trim (start moved right); < 0 → left edge moved left
    const startDelta = newStart - existing.startFrame
    const sourceStartFrame = isUnlimited
      ? existing.sourceStartFrame
      : Math.max(0, existing.sourceStartFrame + Math.round(startDelta * speed))

    // With `assetFrames` the cap is the real end of the media, so both halves of
    // a split can be trimmed back out. Without it, the window's own length —
    // the legacy rule, unchanged.
    const maxDuration = isUnlimited
      ? Infinity
      : Math.floor(sourceFramesAvailable(existing, sourceStartFrame) / speed)
    const clampedDuration = Math.min(maxDuration, Math.max(1, toFrame(durationFrames)))

    // Reject if the trimmed range would overlap another clip on this track.
    const candidate = { startFrame: newStart, durationFrames: clampedDuration }
    if (findOverlaps(trackClips, candidate, clipId).length > 0) return

    // Keyframe frames are counted from the clip's start, so a left-edge trim
    // shifts every key by the negated delta. Keys pushed outside the clip are
    // kept (the sampler holds their end value), which makes a trim lossless:
    // trimming back out restores the exact curve.
    const keyframes =
      existing.keyframes && startDelta !== 0
        ? remapKeyframes(existing.keyframes, { shift: -startDelta })
        : undefined

    this.commit((draft) => {
      updateClip(draft, clipId, trackId, {
        startFrame: newStart,
        durationFrames: clampedDuration,
        sourceStartFrame,
        ...(keyframes ? { keyframes } : {}),
      })
      pruneOrphanedTransitions(draft)
    }, 'Trim clip')
  }

  /**
   * Change a video clip's playback speed (e.g. 2x/4x fast-forward, or a
   * slow-down < 1). Video only — clips on this timeline are audio-stripped,
   * so there is no audio time-stretch concern; calling this on a non-video
   * clip is a no-op.
   *
   * Recomputes `durationFrames` atomically with `speed` so the clip's
   * on-timeline length always reflects how much of its trimmed source window
   * it is currently consuming: `round(durationFrames * speed)` stays within
   * `sourceDurationFrames`. `sourceStartFrame` / `sourceDurationFrames`
   * (the trim window into the source, always at 1x) are untouched — only the
   * RATE at which that window is consumed changes.
   *
   * Speeding up (speed > oldSpeed) always shrinks the clip in place — no
   * overlap is possible. Slowing down grows the clip; if that would overlap
   * the next clip on the track, growth is clamped to the gap before it (no
   * ripple — matches trimClip's overlap behavior) rather than growing into it.
   */
  setClipSpeed(clipId: string, trackId: string, speed: number): void {
    if (this.isTrackLocked(trackId)) return
    const trackClips = this.project.clips[trackId]
    const existing = trackClips?.find((c) => c.id === clipId)
    if (!existing || existing.type !== 'video') return
    // A time-remapped clip's speed IS its `time` keys (EDX-P6); a constant
    // speed on top would be ignored by the resolver, so refuse rather than
    // silently change duration. Clear the remap first.
    if (hasTimeRemap(existing)) return

    const clampedSpeed = Math.max(0.25, Math.min(4, speed))
    const oldSpeed = existing.speed ?? 1
    if (clampedSpeed === oldSpeed) return

    const maxDuration = Math.max(1, Math.floor(sourceFramesAvailable(existing) / clampedSpeed))
    let newDuration = Math.min(
      maxDuration,
      Math.max(1, Math.round((existing.durationFrames * oldSpeed) / clampedSpeed)),
    )

    // Growing (slow-down): never ripple into the next clip — clamp to the
    // gap in front of it instead, mirroring trimClip's silent-reject-via-clamp
    // behavior rather than throwing on overlap.
    if (newDuration > existing.durationFrames) {
      const candidate = { startFrame: existing.startFrame, durationFrames: newDuration }
      const overlaps = findOverlaps(trackClips, candidate, clipId)
      if (overlaps.length > 0) {
        const nearestStart = Math.min(...overlaps.map((c) => c.startFrame))
        newDuration = Math.max(1, nearestStart - existing.startFrame)
      }
    }

    // Keyframes ride the clip's timeline length: a 2x clip plays its motion in
    // half the frames. Scaled in the SAME commit as speed + duration so the
    // three stay one undo entry (see TimelineEngine.speed.test.ts).
    const keyframes = existing.keyframes
      ? remapKeyframes(existing.keyframes, { scale: newDuration / existing.durationFrames })
      : undefined

    // Linked captions (AGN-P8) ride the same length factor as the keyframes —
    // the ACTUAL newDuration ratio, which a clamped slow-down makes differ from
    // the speed ratio — and land in this same commit. A caption that cannot
    // move without overlapping a neighbour is left where it is; never throws.
    const captionPlan = existing.linkId
      ? planCaptionRetime(
          this.getLinked(clipId).filter((c) => c.id !== clipId),
          existing,
          newDuration / existing.durationFrames,
          existing.startFrame + newDuration,
          (id) => this.getClipsOnTrack(id),
        )
      : undefined

    this.commit((draft) => {
      updateClip(draft, clipId, trackId, {
        speed: clampedSpeed,
        durationFrames: newDuration,
        ...(keyframes ? { keyframes } : {}),
      })
      for (const patch of captionPlan?.patches ?? []) {
        updateClip(draft, patch.clipId, patch.trackId, {
          startFrame: patch.startFrame,
          durationFrames: patch.durationFrames,
          words: patch.words,
        })
      }
      pruneOrphanedTransitions(draft)
    }, 'Change clip speed')
  }

  /** The left half keeps the original clip id; returns null when atFrame isn't strictly inside the clip. */
  splitClip(
    clipId: string,
    trackId: string,
    atFrame: number,
  ): [string, string] | null {
    if (this.isTrackLocked(trackId)) return null

    let result: [string, string] | null = null

    this.commit((draft) => {
      result = splitClip(draft, clipId, trackId, atFrame)
      pruneOrphanedTransitions(draft)
    }, 'Split clip')

    if (result) {
      this.emit('clip:split', {
        leftId: result[0],
        rightId: result[1],
        trackId,
      })
    }

    return result
  }

  /** Copies onto the same track at startFrame; returns null instead of throwing when the spot is occupied. */
  cloneClip(
    clipId: string,
    trackId: string,
    startFrame: number,
  ): string | null {
    if (this.isTrackLocked(trackId)) return null

    let newId: string | null = null

    this.commit((draft) => {
      newId = cloneClip(draft, clipId, trackId, startFrame)
    }, 'Clone clip')

    return newId
  }

  // ---------------------------------------------------------------------------
  // Placement, magnetic mode, links and track groups (PV-T1)
  // ---------------------------------------------------------------------------

  /**
   * Place several clips at once — a timeline drag, a paste, a duplicate —
   * with their offsets preserved across tracks. ONE undo step, or nothing.
   *
   * `mode` decides what happens to clips already where they land (see
   * `PlacementMode`): `reject` (default) is `moveClip`'s rule applied to the
   * whole set against the final layout; `overwrite` clears the landing
   * ranges; `insert` pushes later clips on each target track right. `copy`
   * places copies with fresh ids and leaves the originals.
   *
   * Never throws for a placement that cannot run: `ok` is false with a
   * reason and the project is untouched. `moveClip` is unchanged and stays
   * the op layer's single-clip move.
   */
  placeClips(
    moves: ReadonlyArray<ClipPlacement>,
    options: PlaceOptions & { description?: string } = {},
  ): PlaceClipsResult {
    let placed: string[] = []
    try {
      this.commit((draft) => {
        placed = placeClipsInDraft(draft, moves, options)
      }, options.description ?? placementDescription(moves.length, options))
    } catch (err) {
      if (err instanceof PlacementRejected) return { ok: false, reason: err.reason, clipIds: [] }
      throw err
    }
    return { ok: true, clipIds: placed }
  }

  /**
   * Switch the placement model. `'free'` is stored as absence, so a free
   * project's document is exactly what it was before modes existed. Going
   * magnetic with no main track makes the topmost video lane (the bottom
   * compositing layer) the main track in the same undo step.
   */
  setTimelineMode(mode: TimelineMode): void {
    this.commit((draft) => {
      if (mode !== 'magnetic') {
        delete draft.timelineMode
        return
      }
      draft.timelineMode = 'magnetic'
      if (draft.tracks.some((t) => t.role === 'main')) return
      const first = draft.tracks
        .filter((t) => t.kind === 'video')
        .sort((a, b) => a.order - b.order)[0]
      if (first) first.role = 'main'
    }, mode === 'magnetic' ? 'Magnetic timeline' : 'Free timeline')
  }

  /** Make a video track the main track. False, changing nothing, for any other track. */
  setMainTrack(trackId: string): boolean {
    const track = this.getTrack(trackId)
    if (!track || track.kind !== 'video') return false
    this.commit((draft) => {
      for (const t of draft.tracks) {
        if (t.id === trackId) t.role = 'main'
        else if (t.role === 'main') delete t.role
      }
    }, 'Set main track')
    return true
  }

  /**
   * Set or clear the project's composition (PV-P7). One undo step. A composition
   * with no props is removed, so an empty one never reaches a document. The value
   * is cloned, so the caller's object is never frozen by the engine. Bound fields
   * are NOT rewritten here: `commitComposition` / `commitPropValues` do that.
   */
  setComposition(composition: ProjectComposition | null, description = 'Edit composition'): void {
    this.commit((draft) => {
      if (composition === null || composition.props.length === 0) {
        delete draft.composition
        return
      }
      draft.composition = structuredClone(composition) as Draft<ProjectComposition>
    }, description)
  }

  /**
   * Store (or, with `undefined`, clear) the authored document a generated piece
   * came from (EG-P1). One undo step; the input is cloned so a later mutation of
   * the argument cannot change the engine. Never read by the renderer.
   */
  setAuthored(authored: ProjectAuthored | undefined, description = 'Set authored document'): void {
    this.commit((draft) => {
      if (authored === undefined) {
        delete draft.authored
        return
      }
      draft.authored = structuredClone(authored) as Draft<ProjectAuthored>
    }, description)
  }

  /**
   * Record (or, with `null`, clear) the style kit id the project was made in (PQ-2c). One undo step.
   * The renderer never reads it.
   */
  setStyleKit(id: string | null, description = 'Set style kit'): void {
    this.commit((draft) => {
      if (id === null) {
        delete draft.styleKit
        return
      }
      draft.styleKit = id
    }, description)
  }

  /** The magnetic main track's id; undefined in free mode or with no video track. */
  getMainTrackId(): string | undefined {
    return resolveMainTrackId(this.project)
  }

  /**
   * Ripple the magnetic timeline by `delta` frames from `fromFrame`: every
   * main-track clip starting at or after it moves, and so does every clip on
   * an unlocked overlay track starting at or after it — CapCut's linkage,
   * Final Cut's connected clips. When moving the overlays would collide, the
   * main track moves alone and `linked` says so. One undo step.
   */
  rippleMain(fromFrame: number, delta: number, description = 'Ripple'): RippleMainResult {
    const mainId = resolveMainTrackId(this.project)
    if (!mainId) return { ok: false, linked: false }
    const d = Math.round(delta)
    if (!Number.isFinite(d)) return { ok: false, linked: false }
    if (d === 0) return { ok: true, linked: false }
    const from = toFrame(fromFrame)

    const mainMoves = this.getClipsOnTrack(mainId)
      .filter((c) => c.startFrame >= from)
      .map((c) => ({ clipId: c.id, trackId: mainId, delta: d }))
    const overlayMoves: typeof mainMoves = []
    for (const track of this.project.tracks) {
      if (track.id === mainId || track.locked) continue
      for (const c of this.getClipsOnTrack(track.id)) {
        if (c.startFrame >= from) overlayMoves.push({ clipId: c.id, trackId: track.id, delta: d })
      }
    }

    if (overlayMoves.length > 0 && this.shiftClips([...mainMoves, ...overlayMoves], description)) {
      return { ok: true, linked: true }
    }
    return { ok: this.shiftClips(mainMoves, description), linked: false }
  }

  /**
   * Close the gap containing `frame` on a track: every clip after it moves
   * left by the gap's length. On the magnetic main track this ripples the
   * overlays too (`rippleMain`). False, changing nothing, when `frame` is
   * inside a clip, there is nothing after the gap, or a move is refused.
   */
  closeGap(trackId: string, frame: number): boolean {
    const list = this.getClipsOnTrack(trackId)
    const f = toFrame(frame)
    if (list.some((c) => c.startFrame <= f && f < c.startFrame + c.durationFrames)) return false
    const after = list.filter((c) => c.startFrame > f)
    if (after.length === 0) return false
    const gapEnd = Math.min(...after.map((c) => c.startFrame))
    const gapStart = list
      .filter((c) => c.startFrame + c.durationFrames <= f)
      .reduce((end, c) => Math.max(end, c.startFrame + c.durationFrames), 0)
    const length = gapEnd - gapStart
    if (length <= 0) return false
    if (resolveMainTrackId(this.project) === trackId) {
      return this.rippleMain(gapEnd, -length, 'Close gap').ok
    }
    return this.shiftClips(
      after.map((c) => ({ clipId: c.id, trackId, delta: -length })),
      'Close gap',
    )
  }

  /**
   * Link clips so they move, trim, split and delete together. Clips leave
   * whatever group they were in; a group left with one clip dissolves.
   * Returns the new link id, or null for fewer than two known clips.
   */
  linkClips(clipIds: Iterable<string>): string | null {
    const ids = new Set([...clipIds].filter((id) => this.findClip(id)))
    if (ids.size < 2) return null
    const linkId = generateId()
    this.commit((draft) => {
      const previous = new Set<string>()
      for (const list of Object.values(draft.clips)) {
        for (const c of list) {
          if (!ids.has(c.id)) continue
          if (c.linkId) previous.add(c.linkId)
          c.linkId = linkId
        }
      }
      previous.delete(linkId)
      dissolveLonelyLinks(draft, previous)
    }, 'Link clips')
    return linkId
  }

  /** Take clips out of their link groups; a group left with one clip dissolves. */
  unlinkClips(clipIds: Iterable<string>): void {
    const ids = new Set(clipIds)
    this.commit((draft) => {
      const previous = new Set<string>()
      for (const list of Object.values(draft.clips)) {
        for (const c of list) {
          if (!ids.has(c.id) || !c.linkId) continue
          previous.add(c.linkId)
          delete c.linkId
        }
      }
      dissolveLonelyLinks(draft, previous)
    }, 'Unlink clips')
  }

  /** Every clip in `clipId`'s link group, itself included; just itself when unlinked; [] when unknown. */
  getLinked(clipId: string): Clip[] {
    const found = this.findClip(clipId)
    if (!found) return []
    const linkId = found.clip.linkId
    if (!linkId) return [found.clip]
    const out: Clip[] = []
    for (const track of this.project.tracks) {
      for (const c of this.getClipsOnTrack(track.id)) if (c.linkId === linkId) out.push(c)
    }
    return out
  }

  /**
   * Group tracks into one collapsible row. Tracks leave any group they were
   * in; a group left empty is removed. Returns the group id, or null when no
   * id names a track. A view grouping only — compositing is unaffected.
   */
  groupTracks(trackIds: Iterable<string>, name = 'Group'): string | null {
    const wanted = new Set([...trackIds].filter((id) => this.getTrack(id)))
    if (wanted.size === 0) return null
    const ordered = this.project.tracks.filter((t) => wanted.has(t.id)).map((t) => t.id)
    const id = generateId()
    this.commit((draft) => {
      const groups = (draft.trackGroups ?? [])
        .map((g) => ({ ...g, trackIds: g.trackIds.filter((t) => !wanted.has(t)) }))
        .filter((g) => g.trackIds.length > 0)
      groups.push({ id, name, trackIds: ordered, collapsed: false })
      draft.trackGroups = groups
    }, 'Group tracks')
    return id
  }

  /** Dissolve a track group; its tracks are untouched. */
  ungroupTracks(groupId: string): void {
    this.commit((draft) => {
      if (!draft.trackGroups) return
      const idx = draft.trackGroups.findIndex((g) => g.id === groupId)
      if (idx === -1) return
      draft.trackGroups.splice(idx, 1)
      if (draft.trackGroups.length === 0) delete draft.trackGroups
    }, 'Ungroup tracks')
  }

  /** Collapse or expand a track group. */
  setTrackGroupCollapsed(groupId: string, collapsed: boolean): void {
    this.commit((draft) => {
      const group = draft.trackGroups?.find((g) => g.id === groupId)
      if (group) group.collapsed = collapsed
    }, collapsed ? 'Collapse tracks' : 'Expand tracks')
  }

  // ---------------------------------------------------------------------------
  // Transition operations
  // ---------------------------------------------------------------------------

  /**
   * Add a transition between two adjacent clips on the same track.
   * `durationFrames` is the total transition length; the cut point sits at the
   * midpoint, so each clip contributes half the duration.
   */
  addTransition(options: {
    fromClipId: string
    toClipId: string
    trackId: string
    kind: TransitionKind
    durationFrames: number
    easing?: TransitionEasing
    direction?: TransitionDirection
    /** Shift the transition center from the cut point. Negative = more frames from fromClip. */
    offsetFrames?: number
  }): Transition | null {
    const fromClip = this.project.clips[options.trackId]?.find(
      (c) => c.id === options.fromClipId,
    )
    const toClip = this.project.clips[options.trackId]?.find(
      (c) => c.id === options.toClipId,
    )
    if (!fromClip || !toClip) return null

    const half = Math.max(1, Math.floor(options.durationFrames / 2))
    const offset = options.offsetFrames ?? 0
    const transition: Transition = {
      id: generateId(),
      kind: options.kind,
      fromClipId: options.fromClipId,
      toClipId: options.toClipId,
      trackId: options.trackId,
      startFrame: toClip.startFrame - half + offset,
      durationFrames: half * 2,
      easing: options.easing,
      direction: options.direction,
    }

    this.commit((draft) => {
      draft.transitions.push(transition as Draft<Transition>)
    }, 'Add transition')

    this.emit('transition:added', transition)
    return transition
  }

  removeTransition(transitionId: string): void {
    this.commit((draft) => {
      const idx = draft.transitions.findIndex((t) => t.id === transitionId)
      if (idx !== -1) draft.transitions.splice(idx, 1)
    }, 'Remove transition')
    this.emit('transition:removed', transitionId)
  }

  updateTransition(
    transitionId: string,
    patch: Partial<Pick<Transition, 'kind' | 'durationFrames' | 'easing' | 'direction'>> & {
      /** Shift the transition center from the cut point. Negative = more frames from fromClip. */
      offsetFrames?: number
    },
  ): void {
    const existing = this.project.transitions.find((t) => t.id === transitionId)
    if (!existing) return

    this.commit((draft) => {
      const t = draft.transitions.find((t) => t.id === transitionId)
      if (!t) return
      if (patch.kind !== undefined) t.kind = patch.kind
      if (patch.easing !== undefined) t.easing = patch.easing
      if (patch.direction !== undefined) t.direction = patch.direction
      if (patch.durationFrames !== undefined || patch.offsetFrames !== undefined) {
        const newDuration = patch.durationFrames ?? t.durationFrames
        const half = Math.max(1, Math.floor(newDuration / 2))
        t.durationFrames = half * 2
        const toClipEntry = Object.values(draft.clips)
          .flat()
          .find((c) => c.id === t.toClipId)
        if (toClipEntry) {
          const offset = patch.offsetFrames ?? (t.startFrame - (toClipEntry.startFrame - half))
          t.startFrame = toClipEntry.startFrame - half + offset
        }
      }
    }, 'Update transition')
  }

  // ---------------------------------------------------------------------------
  // Compound editing (PV-P1a-3)
  // ---------------------------------------------------------------------------

  /**
   * Replace `clipIds` with one compound clip holding them as a nested timeline.
   * One history entry, so one undo puts every selected clip back.
   *
   * Refuses rather than approximates - a locked lane, a selection that reaches
   * outside itself, a compound that would nest too deep. The refusal carries a
   * `message` to show and nothing is written: no history entry, no event, no
   * change to the project. `data` is the new compound's id.
   */
  nestClips(clipIds: string[], options?: NestOptions): CompoundEditResult<string> {
    const result = nestProject(this.project, clipIds, options)
    if (!result.ok) return result
    this._applyProject(result.data.project, `Nest ${clipIds.length} clip${clipIds.length === 1 ? '' : 's'}`)
    const added = this.findClip(result.data.compoundId)
    if (added) this.emit('clip:added', added.clip)
    return { ok: true, data: result.data.compoundId }
  }

  /**
   * Put a compound's clips back on the timeline and remove the compound, in one
   * history entry. `data` is the restored clips' ids.
   *
   * v1 is lossless or it refuses: a compound that was moved, scaled, trimmed,
   * retimed, faded or given effects cannot be un-nested without inventing a
   * transform-baking pass, so it is left alone with a reason.
   */
  unnestClip(compoundId: string): CompoundEditResult<string[]> {
    const result = unnestProject(this.project, compoundId)
    if (!result.ok) return result
    const before = this.findClip(compoundId)
    this._applyProject(result.data.project, 'Un-nest compound')
    if (before) this.emit('clip:removed', { clipId: compoundId, trackId: before.trackId })
    for (const id of result.data.clipIds) {
      const restored = this.findClip(id)
      if (restored) this.emit('clip:added', restored.clip)
    }
    return { ok: true, data: result.data.clipIds }
  }

  /**
   * Replace a compound's nested project, in ONE undo step (PV-P1c-1).
   *
   * This is the commit half of a child editor: a modal session edits a COPY of
   * the child project and hands it back here. Deliberately NOT `loadProject`,
   * which would destroy undo and autosave context, and deliberately not a
   * per-clip edit, which would make one save many history entries.
   *
   * `opts.expectedChild` is the snapshot the session started from. If the parent's
   * copy no longer matches it, someone else changed this compound while the modal
   * was open, and the save is refused rather than silently overwriting their work.
   * Compared STRUCTURALLY, not by reference: the session's snapshot is immutable
   * and the engine's copy is a fresh immer object, so reference identity would say
   * nothing.
   */
  updateCompoundProject(
    clipId: string,
    child: Project,
    opts: { expectedChild?: Project } = {},
  ): UpdateCompoundResult {
    const checked = this.checkCompoundWrite(clipId, child, opts)
    if (!checked.ok) return checked.failure
    const project = this.project
    const clip = checked.clip

    const next: Project = {
      ...project,
      clips: {
        ...project.clips,
        [clip.trackId]: (project.clips[clip.trackId] ?? []).map((c) =>
          c.id === clipId && c.compound ? { ...c, compound: { project: child } } : c,
        ),
      },
    }
    this._applyProject(next, 'Edit compound')
    const after = this.findClip(clipId)
    if (after) this.emit('clip:updated', after.clip)
    return { ok: true, data: { clipId } }
  }

  /**
   * Replace a component instance's nested project AND its `component` record in
   * ONE undo step (EG-P2). `updateCompoundProject` alone would leave
   * `component.input` describing the old expansion; two calls would be two
   * history entries and a refusal on the second would strand the first.
   *
   * Validates exactly as `updateCompoundProject` does, before anything is
   * written, so a refusal changes nothing. Everything else on the clip is kept.
   */
  updateCompoundInstance(
    clipId: string,
    child: Project,
    component: ClipComponentInstance,
    opts: { expectedChild?: Project } = {},
  ): UpdateCompoundResult {
    const checked = this.checkCompoundWrite(clipId, child, opts)
    if (!checked.ok) return checked.failure
    const project = this.project
    const clip = checked.clip
    const record = structuredClone(component)

    const next: Project = {
      ...project,
      clips: {
        ...project.clips,
        [clip.trackId]: (project.clips[clip.trackId] ?? []).map((c) =>
          c.id === clipId && c.compound ? { ...c, component: record, compound: { project: child } } : c,
        ),
      },
    }
    this._applyProject(next, 'Edit component')
    const after = this.findClip(clipId)
    if (after) this.emit('clip:updated', after.clip)
    return { ok: true, data: { clipId } }
  }

  /**
   * Turn a component instance back into a plain compound: the `component`
   * record is REMOVED (the key is deleted, not set to `undefined`), the nested
   * project and every part are untouched. One undo step.
   */
  detachComponent(clipId: string): UpdateCompoundResult {
    const found = this.findClip(clipId)
    if (!found) return compoundUpdateFailure('clip-not-found', `no clip "${clipId}"`)
    const clip = found.clip
    if (clip.type !== 'compound' || !clip.compound) {
      return compoundUpdateFailure('not-a-compound', `clip "${clipId}" is not a compound`)
    }
    if (!clip.component) return compoundUpdateFailure('no-component', `clip "${clipId}" is not a component instance`)
    const track = this.project.tracks.find((t) => t.id === clip.trackId)
    if (track?.locked) return compoundUpdateFailure('track-locked', `track "${track.id}" is locked`)
    if (track?.disabled) return compoundUpdateFailure('track-disabled', `track "${track.id}" is disabled`)

    const project = this.project
    const next: Project = {
      ...project,
      clips: {
        ...project.clips,
        [clip.trackId]: (project.clips[clip.trackId] ?? []).map((c) => {
          if (c.id !== clipId) return c
          const { component: _dropped, ...rest } = c
          return rest
        }),
      },
    }
    this._applyProject(next, 'Detach component')
    const after = this.findClip(clipId)
    if (after) this.emit('clip:updated', after.clip)
    return { ok: true, data: { clipId } }
  }

  /** The refusals shared by every write to a compound's nested project. Writes nothing. */
  private checkCompoundWrite(
    clipId: string,
    child: Project,
    opts: { expectedChild?: Project },
  ): { ok: true; clip: Clip } | { ok: false; failure: UpdateCompoundResult } {
    const project = this.project
    const fail = (code: UpdateCompoundErrorCode, message: string) => ({ ok: false as const, failure: compoundUpdateFailure(code, message) })
    const found = this.findClip(clipId)
    if (!found) return fail('clip-not-found', `no clip "${clipId}"`)
    const clip = found.clip
    if (clip.type !== 'compound' || !clip.compound) {
      return fail('not-a-compound', `clip "${clipId}" is not a compound`)
    }
    const track = project.tracks.find((t) => t.id === clip.trackId)
    if (track?.locked) return fail('track-locked', `track "${track.id}" is locked`)
    if (track?.disabled) return fail('track-disabled', `track "${track.id}" is disabled`)

    // A child authored at a different frame rate would need its whole timeline
    // re-expressed in the parent's frames; refusing is the only honest answer.
    if (child.fps !== project.fps) {
      return fail('fps-mismatch', `child is ${child.fps}fps, the document is ${project.fps}fps`)
    }

    // The compound's own depth in this document, plus the deepest chain inside the
    // new child, must stay within the reader's limit — otherwise the document
    // would be one that `projectDocument` refuses to read back.
    const parentDepth = compoundDepths(this.project).get(clipId) ?? 0
    const childDepth = deepestCompoundChain(child)
    if (parentDepth + 1 + childDepth > MAX_COMPOUND_DEPTH) {
      return fail(
        'too-deep',
        `a compound ${parentDepth + 1 + childDepth} levels deep exceeds the ${MAX_COMPOUND_DEPTH}-level limit`,
      )
    }

    if (opts.expectedChild && !sameProject(opts.expectedChild, clip.compound.project)) {
      return fail('stale-child', 'the compound changed outside this editor')
    }
    return { ok: true, clip }
  }

  // ---------------------------------------------------------------------------
  // Project loading (restore)
  // ---------------------------------------------------------------------------

  /**
   * Replace the whole composition with a stored one.
   *
   * This is the restore half of `getProject()`: what the editor calls when a
   * saved document comes back from the server. It is deliberately *not* an
   * edit —
   *
   *  - **Atomic.** Tracks, clips, transitions, stage, fps and master volume are
   *    swapped in one assignment. No subscriber ever sees the old tracks beside
   *    the new clips, which is the state every `clips[track.id]` lookup in the
   *    app would read as `undefined`.
   *  - **The new baseline.** History is dropped, not appended to. Undo after
   *    opening a project must do nothing; walking back into the empty timeline
   *    that existed for a few milliseconds before the document arrived would
   *    look exactly like losing the project.
   *  - **Stopped at the start.** The playhead belonged to the composition being
   *    replaced. `'project:loaded'` carries the instruction, because
   *    `PlaybackEngine` is a separate object that this one deliberately does not
   *    know about; the composition layer wires the two together
   *    (`EditorProvider`). Pass `transport: 'keep'` for a repair pass that
   *    replaces references inside the composition already on screen, where a
   *    jump to frame 0 would be an unexplained surprise.
   *
   * `project` must already be a valid `Project`. Anything arriving as JSON goes
   * through {@link readProjectDocument} first — that is where an unreadable or
   * too-new document is refused, and it is separate from this method so the
   * refusal can be shown to the user before the editor's contents are thrown
   * away.
   *
   * An in-progress `batch()` or drag is abandoned rather than merged: both
   * describe edits to a composition that no longer exists.
   *
   * **`history: 'keep'` is the exception, and only one caller has it.** The
   * media re-link (`relinkProjectMedia`) does not bring a new composition — it
   * hands back the one already on screen with internal library references
   * repaired, and it lands whenever the project's assets finish importing,
   * which can be long after the open. Everything above stops being true for it:
   * there is no earlier composition to protect undo from, the user's edits since
   * the open are real history, and an open drag is a real gesture that still has
   * a `commitInteraction()` coming. So that call keeps the stacks, the
   * interaction snapshot and any open batch intact. (Entries already on the
   * stacks still hold the pre-repair references; undoing past the repair costs a
   * filmstrip, not work — and those ids are session-scoped anyway.)
   */
  loadProject(
    project: Project,
    options?: { transport?: LoadProjectTransport; history?: LoadProjectHistory },
  ): void {
    if (options?.history !== 'keep') {
      this.batchDepth = 0
      this.batchPrev = null
      this.batchDescription = null
      this.interactionPrev = null
      this.undoStack = []
      this.redoStack = []
    }

    this.project = project
    this._revision++

    // 'change' first, so anything that re-reads the engine from
    // 'project:loaded' (the transport reset does) sees stores already synced to
    // the composition it is resetting for.
    this.emit('change', this.project)
    this.emit('history:change', { canUndo: this.canUndo(), canRedo: this.canRedo() })
    this.emit('project:loaded', {
      project: this.project,
      transport: options?.transport ?? 'rewind',
    })
  }

  // ---------------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------------

  /**
   * Group multiple engine mutations into a single undo entry.
   *
   * Inside the recipe, every public mutation method (addClip, splitClip, …)
   * still applies normally — `this.project` is kept up-to-date so reads
   * between mutations are correct — but the per-call history entries and
   * 'change' events are suppressed. When the outermost batch closes, one
   * history entry covering prev → final is pushed and one 'change' fires.
   *
   * Nested batch() calls collapse into the outermost transaction.
   * If the recipe throws, the project rolls back to its pre-batch snapshot
   * and the error re-throws.
   *
   * @example
   * engine.batch(() => {
   *   engine.removeClip(a, t)
   *   engine.addClip({ ... })
   * }, 'Replace clip')
   */
  batch(recipe: () => void, description?: string): void {
    if (this.batchDepth === 0) {
      this.batchPrev = this.project
      this.batchDescription = description ?? null
    }
    this.batchDepth++

    try {
      recipe()
    } catch (err) {
      this.batchDepth = Math.max(0, this.batchDepth - 1)
      if (this.batchDepth === 0) {
        // Roll back any partial mutations from inner commits — unless a
        // loadProject inside the recipe already replaced the composition those
        // mutations belonged to, in which case there is nothing to roll back to.
        if (this.batchPrev !== null) this.project = this.batchPrev
        this._revision++
        this.batchPrev = null
        this.batchDescription = null
      }
      throw err
    }

    // Clamped rather than decremented: a loadProject inside the recipe resets
    // the depth, and a negative one would make the *next* batch think it is
    // nested inside a transaction that no longer exists.
    this.batchDepth = Math.max(0, this.batchDepth - 1)
    if (this.batchDepth > 0) return // nested batch — wait for outermost

    const prev = this.batchPrev
    const next = this.project
    const desc = this.batchDescription ?? 'Batch'
    this.batchPrev = null
    this.batchDescription = null

    // The transaction was abandoned by a restore. Recording an entry now would
    // put `undo` one step away from a composition that was thrown away — and
    // with no snapshot to return to, that step leads nowhere at all.
    if (prev === null) return

    if (next === prev) return // no net change — nothing to record

    const entry: HistoryEntry = { prev, next, description: desc }
    this.undoStack.push(entry)
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift()
    }
    this.redoStack = []

    this.emit('change', this.project)
    this.emit('history:change', {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    })
  }

  // ---------------------------------------------------------------------------
  // History (undo / redo)
  // ---------------------------------------------------------------------------

  /**
   * A counter that changes whenever the project does — commits, undo, redo,
   * loads, interaction previews. The editing assistant (EDX-P11) records it
   * when it applies a plan, so "Discard" can refuse once anything else has
   * happened since.
   */
  getRevision(): number {
    return this._revision
  }

  /**
   * Revert the most recent history entry and forget it (no redo), but only
   * if nothing has changed since `revision` — the assistant's "Discard" for
   * a plan it previewed on the live timeline. False when it cannot.
   */
  discardLast(revision: number): boolean {
    if (revision !== this._revision || this.batchDepth > 0) return false
    const entry = this.undoStack.pop()
    if (!entry) return false
    this.project = entry.prev
    this._revision++
    this.emit('change', this.project)
    this.emit('history:change', {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    })
    return true
  }

  /** The label of the most recent undo entry, if any. */
  lastHistoryDescription(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.description ?? null
  }

  undo(): boolean {
    const entry = this.undoStack.pop()
    if (!entry) return false

    this.redoStack.push(entry)
    this.project = entry.prev
    this._revision++

    this.emit('change', this.project)
    this.emit('history:change', {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    })

    return true
  }

  redo(): boolean {
    const entry = this.redoStack.pop()
    if (!entry) return false

    this.undoStack.push(entry)
    this.project = entry.next
    this._revision++

    this.emit('change', this.project)
    this.emit('history:change', {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    })

    return true
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  on<E extends EngineEvent>(event: E, listener: Listener<E>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(listener)
  }

  off<E extends EngineEvent>(event: E, listener: Listener<E>): void {
    this.listeners.get(event)?.delete(listener)
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Apply a mutation via Immer, record the history entry, and emit 'change'.
   * All public mutations funnel through here — never mutate this.project directly.
   *
   * When called from inside a batch(), the mutation is still applied to
   * this.project (so subsequent reads inside the batch are correct) but the
   * history push and 'change' / 'history:change' emits are deferred to the
   * outer batch.
   */
  private commit(
    recipe: (draft: Draft<Project>) => void,
    description: string,
  ): void {
    const prev = this.project
    const next = produce(prev, (draft) => {
      recipe(draft)
      // A document is stamped with the lowest version that describes it
      // (projectDocument.ts), in the SAME step as the edit that needed it —
      // so undo stays one step and an older build says "update" rather than
      // "unreadable". Only ever raised here; loading decides the rest.
      const need = documentVersionFor(draft)
      if (draft.version < need) draft.version = need
    })

    if (next === prev) return // Immer detected no change — nothing to record

    this.project = next
    this._revision++

    if (this.batchDepth > 0) {
      if (this.batchDescription === null) this.batchDescription = description
      return
    }

    const entry: HistoryEntry = { prev, next, description }

    this.undoStack.push(entry)
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift()
    }
    this.redoStack = []

    this.emit('change', this.project)
    this.emit('history:change', {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    })
  }

  /**
   * Adopt `next`'s content as ONE history entry, through the private commit
   * path.
   *
   * Not `loadProject`: a load is a new baseline and drops history, so an edit
   * made through it could not be undone - which would make "nest" the one
   * action in the editor with no way back. Only the fields a nest or an un-nest
   * can change are copied; the document's own identity, stage, frame rate,
   * markers, in/out and master volume pass through as they are, because the pure
   * functions leave them alone.
   */
  private _applyProject(next: Project, description: string): void {
    this.commit(
      (draft) => {
        draft.tracks = next.tracks as Draft<Track>[]
        draft.clips = next.clips as unknown as Draft<Project>['clips']
        draft.transitions = next.transitions as Draft<Transition>[]
        if (next.trackGroups) {
          draft.trackGroups = next.trackGroups as Draft<NonNullable<Project['trackGroups']>>
        } else {
          delete draft.trackGroups
        }
        // Assigned, not raised: the stamp follows the content in both
        // directions, so an un-nest drops a document from 4 back to whatever the
        // rest of it needs. commit() re-raises it if the recipe needs a higher
        // one, which is what keeps a legacy caller of commit() correct.
        draft.version = next.version
      },
      description,
    )
  }

  private emit<E extends EngineEvent>(
    event: E,
    payload: EngineEventPayload[E],
  ): void {
    this.listeners.get(event)?.forEach((fn) => fn(payload))
  }
}
