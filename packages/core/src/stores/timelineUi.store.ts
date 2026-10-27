import { createStore } from 'zustand/vanilla'

/**
 * The timeline's pointer tool (PV-T1). `select` is the everyday tool: edge
 * drags trim, Ctrl+edge ripples, the cut zone rolls. `trim` turns clip-body
 * drags into slip (over the filmstrip) and slide (over the name bar).
 */
export type TimelineTool = 'select' | 'trim'

export interface TimelineUiState {
  tool: TimelineTool
  /** Selecting a clip selects its link group too. On by default, as in every pro editor. */
  linkedSelection: boolean
  /** Scroll the timeline to keep the playhead in view while it plays. */
  followPlayhead: boolean
  /**
   * Height of every track, px (PV-T4). One height for the whole timeline, as
   * Premiere's track-height preset is: tracks stay uniform, and the height is
   * the viewer's preference rather than part of the project.
   */
  trackHeight: number
  /**
   * Width of the track-header column, px (PV-T4): dragged on its right edge
   * where the headers meet the lanes, as in Premiere and Resolve.
   */
  headerWidth: number
}

export interface TimelineUiActions {
  setTool: (tool: TimelineTool) => void
  toggleLinkedSelection: () => void
  setLinkedSelection: (on: boolean) => void
  setFollowPlayhead: (on: boolean) => void
  /** Clamped to 24–200 px. */
  setTrackHeight: (px: number) => void
  /** Clamped to 140–360 px. */
  setHeaderWidth: (px: number) => void
}

const STORAGE_KEY = 'elah-timeline-ui'

/** The default track height: the editor's 'normal' preset. */
export const DEFAULT_TRACK_HEIGHT_PX = 54

/** The default track-header width (the timeline package's SIDEBAR_WIDTH). */
export const DEFAULT_HEADER_WIDTH_PX = 184
export const MIN_HEADER_WIDTH_PX = 140
export const MAX_HEADER_WIDTH_PX = 360

function clampHeaderWidth(px: number): number {
  return Number.isFinite(px)
    ? Math.max(MIN_HEADER_WIDTH_PX, Math.min(MAX_HEADER_WIDTH_PX, Math.round(px)))
    : DEFAULT_HEADER_WIDTH_PX
}

function clampHeight(px: number): number {
  return Number.isFinite(px) ? Math.max(24, Math.min(200, Math.round(px))) : DEFAULT_TRACK_HEIGHT_PX
}

const PERSISTED_KEYS = ['tool', 'linkedSelection', 'followPlayhead', 'trackHeight', 'headerWidth'] as const satisfies readonly (keyof TimelineUiState)[]

function readPersisted(): Partial<TimelineUiState> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { state?: Partial<TimelineUiState> }
    const stored = parsed?.state
    if (!stored || typeof stored !== 'object') return {}
    const out: Partial<TimelineUiState> = {}
    if (stored.tool === 'select' || stored.tool === 'trim') out.tool = stored.tool
    if (typeof stored.linkedSelection === 'boolean') out.linkedSelection = stored.linkedSelection
    if (typeof stored.followPlayhead === 'boolean') out.followPlayhead = stored.followPlayhead
    if (typeof stored.trackHeight === 'number') out.trackHeight = clampHeight(stored.trackHeight)
    if (typeof stored.headerWidth === 'number') out.headerWidth = clampHeaderWidth(stored.headerWidth)
    return out
  } catch {
    // Private mode, blocked storage, or a document written by a future build.
    return {}
  }
}

/**
 * Timeline preferences (PV-T1): UI-only, never in project history. Vanilla
 * so core stays React-free; the React binding binds it as
 * `useTimelineUiStore`. Persisted by hand on change, like `playbackStore`,
 * so no write happens unless a preference actually moved.
 */
export const timelineUiStore = createStore<TimelineUiState & TimelineUiActions>()((set) => ({
  tool: 'select',
  linkedSelection: true,
  followPlayhead: true,
  trackHeight: DEFAULT_TRACK_HEIGHT_PX,
  headerWidth: DEFAULT_HEADER_WIDTH_PX,
  ...readPersisted(),

  setTool: (tool) => set({ tool }),
  toggleLinkedSelection: () => set((s) => ({ linkedSelection: !s.linkedSelection })),
  setLinkedSelection: (on) => set({ linkedSelection: on }),
  setFollowPlayhead: (on) => set({ followPlayhead: on }),
  setTrackHeight: (px) => set({ trackHeight: clampHeight(px) }),
  setHeaderWidth: (px) => set({ headerWidth: clampHeaderWidth(px) }),
}))

// Written on the trailing edge: a header or height drag moves a preference
// every frame, and only where it settles is worth a storage write.
const PERSIST_DELAY_MS = 250
let persistTimer: ReturnType<typeof setTimeout> | null = null

timelineUiStore.subscribe((state, prev) => {
  if (typeof localStorage === 'undefined') return
  if (PERSISTED_KEYS.every((key) => state[key] === prev[key])) return
  if (persistTimer !== null) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    persist(timelineUiStore.getState())
  }, PERSIST_DELAY_MS)
})

function persist(state: TimelineUiState): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          tool: state.tool,
          linkedSelection: state.linkedSelection,
          followPlayhead: state.followPlayhead,
          trackHeight: state.trackHeight,
          headerWidth: state.headerWidth,
        },
        version: 0,
      }),
    )
  } catch {
    // Quota or private mode: losing a remembered tool is not worth failing over.
  }
}
