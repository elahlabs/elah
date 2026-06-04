import { produce, type Draft } from 'immer'
import type {
  Clip,
  EngineEvent,
  EngineEventPayload,
  Project,
  TimelineConfig,
  Track,
  TrackKind,
} from '../types'
import { generateId } from '../utils/id'
import { getTotalFrames, toFrame, findOverlaps } from '../utils/frames'
import { createTrack, type CreateTrackOptions } from '../track/track'
import { createClip, type CreateClipOptions } from '../elements/base'
import { addClip } from '../visitor/add'
import { removeClip, removeTrack } from '../visitor/remove'
import { updateClip, updateTrack } from '../visitor/update'
import { splitClip } from '../visitor/split'
import { cloneClip } from '../visitor/clone'

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

function buildEmptyProject(
  fps: number,
  stage: { width: number; height: number },
): Project {
  const firstTrack = createTrack({ kind: 'video', name: 'Track 1', order: 0 })
  return {
    id: generateId(),
    fps,
    stage,
    tracks: [firstTrack],
    clips: {},
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
  private batchPrev: Project | null = null
  private batchDescription: string | null = null

  // Snapshot of the project taken when an interactive gesture (previewClip)
  // begins, so commitInteraction() can record one undo entry for the whole drag.
  private interactionPrev: Project | null = null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private listeners = new Map<EngineEvent, Set<(payload: any) => void>>()

  constructor(config: TimelineConfig) {
    const stage = config.stage ?? { width: 1080, height: 1920 }
    this.project = buildEmptyProject(config.fps, stage)
    this.maxHistorySize = config.maxHistorySize ?? 100
    this.defaultTrackHeight = config.defaultTrackHeight ?? 64
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  getProject(): Project {
    return this.project
  }

  getTrack(trackId: string): Track | undefined {
    return this.project.tracks.find((t) => t.id === trackId)
  }

  getClipsOnTrack(trackId: string): Clip[] {
    return this.project.clips[trackId] ?? []
  }

  findClip(clipId: string): { clip: Clip; trackId: string } | null {
    for (const [trackId, clips] of Object.entries(this.project.clips)) {
      const clip = clips.find((c) => c.id === clipId)
      if (clip) return { clip, trackId }
    }
    return null
  }

  getTotalFrames(): number {
    return getTotalFrames(this.project.clips)
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

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

  // ---------------------------------------------------------------------------
  // Track operations
  // ---------------------------------------------------------------------------

  addTrack(kind: TrackKind, options?: Partial<CreateTrackOptions>): Track {
    const order = this.project.tracks.length
    const track = createTrack({
      kind,
      order,
      height: this.defaultTrackHeight,
      ...options,
    })

    this.commit(
      (draft) => {
        draft.tracks.push(track as Draft<Track>)
        draft.clips[track.id] = []
      },
      `Add ${kind} track`,
    )

    this.emit('track:added', track)
    return track
  }

  removeTrack(trackId: string): void {
    this.commit(
      (draft) => removeTrack(draft, trackId),
      `Remove track`,
    )
    this.emit('track:removed', trackId)
  }

  updateTrack(trackId: string, updates: Partial<Track>): void {
    this.commit(
      (draft) => updateTrack(draft, trackId, updates),
      `Update track`,
    )
  }

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

  addClip(options: CreateClipOptions): Clip {
    const clip = createClip(options)

    this.commit(
      (draft) => addClip(draft, clip),
      `Add ${clip.type} clip`,
    )

    this.emit('clip:added', clip)
    return clip
  }

  removeClip(clipId: string, trackId: string): void {
    this.commit(
      (draft) => removeClip(draft, clipId, trackId),
      `Remove clip`,
    )
    this.emit('clip:removed', { clipId, trackId })
  }

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
    }, 'Move clip')
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
    // Read from the current project snapshot so we can validate before committing.
    const trackClips = this.project.clips[trackId]
    const existing = trackClips?.find((c) => c.id === clipId)
    if (!existing) return

    const isText = existing.type === 'text'

    const maxDuration = isText ? Infinity : existing.sourceDurationFrames
    const clampedDuration = Math.min(maxDuration, Math.max(1, toFrame(durationFrames)))

    // For media clips, the left edge can't extend further left than the source
    // has available frames (i.e., existing.sourceStartFrame frames to the left).
    // Text clips have no source constraint and are always allowed to grow left.
    const rawStart = Math.max(0, toFrame(startFrame))
    const minAllowedStart = isText
      ? 0
      : Math.max(0, existing.startFrame - existing.sourceStartFrame)
    const newStart = Math.max(minAllowedStart, rawStart)

    // Reject if the trimmed range would overlap another clip on this track.
    const candidate = { startFrame: newStart, durationFrames: clampedDuration }
    if (findOverlaps(trackClips, candidate, clipId).length > 0) return

    // startDelta > 0 → left-edge trim (start moved right); < 0 → left edge moved left
    const startDelta = newStart - existing.startFrame
    // Text clips have no real source media, skip the source window adjustment.
    const sourceStartFrame = isText
      ? existing.sourceStartFrame
      : Math.max(0, existing.sourceStartFrame + startDelta)

    this.commit((draft) => {
      updateClip(draft, clipId, trackId, {
        startFrame: newStart,
        durationFrames: clampedDuration,
        sourceStartFrame,
      })
    }, 'Trim clip')
  }

  splitClip(
    clipId: string,
    trackId: string,
    atFrame: number,
  ): [string, string] | null {
    let result: [string, string] | null = null

    this.commit((draft) => {
      result = splitClip(draft, clipId, trackId, atFrame)
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

  cloneClip(
    clipId: string,
    trackId: string,
    startFrame: number,
  ): string | null {
    let newId: string | null = null

    this.commit((draft) => {
      newId = cloneClip(draft, clipId, trackId, startFrame)
    }, 'Clone clip')

    return newId
  }

  // ---------------------------------------------------------------------------
  // Project loading
  // ---------------------------------------------------------------------------

  loadProject(project: Project): void {
    this.project = project
    this.undoStack = []
    this.redoStack = []
    this.emit('change', this.project)
    this.emit('history:change', { canUndo: false, canRedo: false })
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
      this.batchDepth--
      if (this.batchDepth === 0) {
        // Roll back any partial mutations from inner commits.
        this.project = this.batchPrev!
        this.batchPrev = null
        this.batchDescription = null
      }
      throw err
    }

    this.batchDepth--
    if (this.batchDepth > 0) return // nested batch — wait for outermost

    const prev = this.batchPrev!
    const next = this.project
    const desc = this.batchDescription ?? 'Batch'
    this.batchPrev = null
    this.batchDescription = null

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

  undo(): boolean {
    const entry = this.undoStack.pop()
    if (!entry) return false

    this.redoStack.push(entry)
    this.project = entry.prev

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
    const next = produce(prev, recipe)

    if (next === prev) return // Immer detected no change — nothing to record

    this.project = next

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

  private emit<E extends EngineEvent>(
    event: E,
    payload: EngineEventPayload[E],
  ): void {
    this.listeners.get(event)?.forEach((fn) => fn(payload))
  }
}
