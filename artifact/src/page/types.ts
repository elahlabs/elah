/**
 * HTML-first page source (PLAN-HTML-FIRST section 3): a self-contained HTML + CSS page whose real CSS
 * animations ARE the video. The artifact previews it as HTML; Export (HF-2) and Edit (HF-3) plug in through
 * the hooks below.
 */

import type { Issue } from '../input'

/** A validated, fully defaulted page. */
export interface PageSource {
  kind: 'page'
  html: string
  css: string
  durationSeconds: number
  stage: { width: number; height: number }
  fps: number
}

/** The window (seconds) a `[data-scene]` element's own finite animations cover. */
export interface SceneWindow {
  name: string
  start: number
  end: number
}

/** What the mounted page exposes to export / edit code and to browser probes (`window.__elahPage`). */
export interface PagePlayerHandle {
  readonly page: PageSource
  readonly root: ShadowRoot
  readonly stageEl: HTMLElement
  readonly scenes: readonly SceneWindow[]
  /** The layout report measured at mount: its warnings and how long it took (ms). */
  readonly layout: { issues: Issue[]; ms: number; times: number[] }
  /** Every animation under the stage, paused. Collected once at mount. */
  animations(): Animation[]
  /** Seek the page AND the scrub bar / readout to `t` seconds (clamped to the video). */
  seek(t: number): void
  time(): number
  play(): void
  pause(): void
  isPlaying(): boolean
}

export type PageStatus = { text: string; progress?: number } | null

export interface PageActionContext {
  page: PageSource
  title: string
  /** The live player (mounted page). Null only if the page failed to mount. */
  player: PagePlayerHandle | null
  setStatus: (s: PageStatus) => void
}

export interface PageExportContext extends PageActionContext {
  /** Aborted when the user presses "Cancel export". */
  signal: AbortSignal
}

/**
 * The seam. `App.tsx` exports a `pageHooks` object with these two functions; HF-2 replaces `onExportPage`
 * (Export MP4 from the HTML) and HF-3 replaces `onEditPage` (convert the page to native clips + keys).
 */
export interface PageHooks {
  onExportPage: (ctx: PageExportContext) => Promise<void>
  onEditPage: (ctx: PageActionContext) => void | Promise<void>
}
