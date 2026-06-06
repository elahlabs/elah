/**
 * trace — channel-based, console-triggerable frame-lifecycle logging.
 *
 * Channels are named after the study-plan frame-lifecycle tags. A channel is
 * silent unless explicitly enabled, so `trace()` is an O(1) Set lookup on hot
 * paths (DRAW, CACHE_GET fire per frame) when off.
 *
 * Control it from the browser console via `window.__trace`:
 *   __trace.on('SET_PLAYHEAD', 'PLAYHEAD')   // enable specific channels
 *   __trace.all()                            // enable every channel
 *   __trace.off('PLAYHEAD')                  // disable one
 *   __trace.none()                           // disable everything
 *   __trace.status()                         // list enabled channels
 *
 * Enabled channels persist across reloads via localStorage, so a study session
 * survives a page refresh.
 *
 * Guarded for non-browser environments (tests, SSR): no window/localStorage
 * access at import time beyond feature checks.
 */

export type TraceChannel =
  // ── Playback clock (wired) ───────────────────────────────────────────────
  | 'SET_PLAYHEAD' // seek() command fired
  | 'PLAYHEAD' // notify() broadcast an integer frame to followers
  | 'SEEK_GATE' // store→engine guard: did a seek pass or get swallowed?
  // ── Media pipeline (wire as you reach each session) ──────────────────────
  | 'FEED' // StreamingFrameProducer.feedWindow()
  | 'DECODE' // VideoDecoder.output()
  | 'CACHE_PUT' // FrameCache.put()
  | 'CACHE_GET' // FrameCache lookup (getCurrent)
  // ── Renderer (wire as you reach each session) ────────────────────────────
  | 'UPLOAD' // VideoTexture.upload()
  | 'DRAW' // WebGL drawArrays()
  // ── Export pipeline (ExportWorker + exportVideo, runs in a Worker) ────────
  | 'EXPORT' // high-level lifecycle: start, clip inventory, done
  | 'EXPORT_ASSETS' // video CanvasSinks + image ImageBitmaps loading
  | 'EXPORT_AUDIO' // main-thread mix + in-worker PCM encoding
  | 'EXPORT_MUX' // mediabunny Output setup / start / finalize
  | 'EXPORT_FRAMES' // frame render loop progress

const ALL_CHANNELS: TraceChannel[] = [
  'SET_PLAYHEAD',
  'PLAYHEAD',
  'SEEK_GATE',
  'FEED',
  'DECODE',
  'CACHE_PUT',
  'CACHE_GET',
  'UPLOAD',
  'DRAW',
  'EXPORT',
  'EXPORT_ASSETS',
  'EXPORT_AUDIO',
  'EXPORT_MUX',
  'EXPORT_FRAMES',
]

const STORAGE_KEY = 'myeditor-trace-channels'

const enabled = new Set<TraceChannel>()

function persist(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...enabled]))
  } catch {
    // localStorage can throw in private mode / quota — tracing is best-effort.
  }
}

function restore(): void {
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    for (const ch of JSON.parse(raw) as TraceChannel[]) {
      if (ALL_CHANNELS.includes(ch)) enabled.add(ch)
    }
  } catch {
    // Ignore malformed persisted state.
  }
}

/** Emit a log line if `channel` is enabled. Cheap no-op otherwise. */
export function trace(channel: TraceChannel, ...args: unknown[]): void {
  if (!enabled.has(channel)) return
  console.log(`[${channel}]`, ...args)
}

/** True if a channel is on — guard expensive payload construction with this. */
export function traceEnabled(channel: TraceChannel): boolean {
  return enabled.has(channel)
}

/**
 * Snapshot the currently-enabled channels. Used to forward the main thread's
 * trace state into a Worker, which has no `window`/`localStorage` of its own.
 */
export function getEnabledChannels(): TraceChannel[] {
  return [...enabled]
}

/**
 * Programmatically enable channels without touching `localStorage`. Used inside
 * a Worker to honour the channels the main thread had on when export started;
 * `window.__trace` is unavailable there.
 */
export function enableChannels(channels: TraceChannel[]): void {
  for (const ch of channels) {
    if (ALL_CHANNELS.includes(ch)) enabled.add(ch)
  }
}

interface TraceConsoleApi {
  on(...channels: TraceChannel[]): TraceChannel[]
  off(...channels: TraceChannel[]): TraceChannel[]
  all(): TraceChannel[]
  none(): TraceChannel[]
  status(): TraceChannel[]
  channels: TraceChannel[]
}

declare global {
  interface Window {
    __trace?: TraceConsoleApi
  }
}

export function installTraceGlobal(): void {
  if (typeof window === 'undefined') return

  restore()

  const api: TraceConsoleApi = {
    on(...channels) {
      for (const ch of channels) enabled.add(ch)
      persist()
      return [...enabled]
    },
    off(...channels) {
      for (const ch of channels) enabled.delete(ch)
      persist()
      return [...enabled]
    },
    all() {
      for (const ch of ALL_CHANNELS) enabled.add(ch)
      persist()
      return [...enabled]
    },
    none() {
      enabled.clear()
      persist()
      return []
    },
    status() {
      return [...enabled]
    },
    channels: ALL_CHANNELS,
  }

  Object.defineProperty(window, '__trace', {
    configurable: true,
    enumerable: true,
    value: api,
  })
}
