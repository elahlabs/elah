import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { GpuRenderer } from '@elah/core'
import { resolveTimeline } from '@elah/core'
import { useTimelineEngine, usePlaybackEngine } from '@elah/react'
import type { Clip, DemuxerFactory } from '@elah/core'
import {
  AudioPlaybackController,
  PerfSummary,
  clipLoadStore,
  preloadProjectImages,
  warmImageSrc,
  warmVideoSrc,
} from '@elah/core'
import { useMediaLibraryStore, usePlaybackStore } from '@elah/react'
import type { AudioResolver } from '@elah/core'
import { cn } from '@elah/timeline'
import { TextOverlay } from './TextOverlay'
import { ShapeOverlay } from './ShapeOverlay'
import { MediaTransformOverlay } from './MediaTransformOverlay'
import { PreviewLoadingOverlay } from './PreviewLoadingOverlay'
import { TransitionOverlay, type TransitionOverlayHandle } from './TransitionOverlay'
import { StageBorder } from './StageBorder'

/**
 * Imperative handle exposed via ref. Lets a host (e.g. a playground or dev
 * tools) reach the underlying renderer/canvas for pixel readbacks, recording,
 * or test hooks — without the library having to know those concerns exist.
 */
export interface PreviewHandle {
  /** The WebGL canvas element, or null before mount / after dispose. */
  getCanvas(): HTMLCanvasElement | null
  /** The underlying GpuRenderer instance, or null before mount / after dispose. */
  getRenderer(): GpuRenderer | null
}

export interface PreviewProps {
  /**
   * Demuxer factory wiring the decode backend (e.g. mediabunny). Required for
   * real playback. Injected by the host so this library never imports a demuxer
   * implementation directly. Omit only when `probeLayer` is true.
   */
  demuxerFactory?: DemuxerFactory
  /** Show the GPU debug overlay (FPS, cache hit ratio, decoder state). */
  debug?: boolean
  /**
   * Bisection probe: paint synthetic colour + "frame N" per clip instead of
   * decoded media, to isolate the clock/render/draw path from decode. Default false.
   */
  probeLayer?: boolean
  /** Clear colour as [r, g, b, a] in 0..1. Defaults to opaque black (letterbox bars). */
  clearColor?: [number, number, number, number]
  /**
   * Retain the GL drawing buffer so host code can call `gl.readPixels()` after a
   * render tick yields (dev tools, golden-pixel tests, recording). Costs one
   * extra buffer copy per frame. Default false.
   */
  preserveDrawingBuffer?: boolean
  /**
   * Play the project's audio track in sync with the playback clock. Default true.
   * Set false for silent previews / non-audio consumers (and to skip building an
   * AudioContext at all).
   */
  enableAudio?: boolean
  /** Injectable URL→bytes seam for the audio decode cache (CDN/auth/proxy overrides). Defaults to fetch(src).arrayBuffer(). */
  audioResolver?: AudioResolver
  style?: CSSProperties
  className?: string
}

/**
 * `<Preview>` — the reusable playback surface of `@elah/editor`.
 *
 * Mounts a `GpuRenderer`, drives a RAF loop that samples the playback clock,
 * resolves the timeline at the current frame, and renders the resulting Scene.
 * All playback runs imperatively — there is no React re-render at 60 Hz.
 *
 * Must be rendered inside an `<EditorProvider>` (it reads the timeline +
 * playback engines from context). Transport UI (play/pause/scrub) is the host's
 * concern; this component only paints.
 */
export const Preview = forwardRef<PreviewHandle, PreviewProps>(function Preview(
  {
    demuxerFactory,
    debug = false,
    probeLayer = false,
    clearColor,
    preserveDrawingBuffer,
    enableAudio = true,
    audioResolver,
    style,
    className,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<GpuRenderer | null>(null)
  const transitionOverlayRef = useRef<TransitionOverlayHandle>(null)
  const engine = useTimelineEngine()
  const playback = usePlaybackEngine()

  // 'lost' shows a passive "recovering" notice while the context-loss watchdog
  // runs; 'failed' offers a manual renderer remount (bump reloadKey → the mount
  // effect below re-runs, disposing and recreating everything).
  const [glState, setGlState] = useState<'ok' | 'lost' | 'failed'>('ok')
  const [reloadKey, setReloadKey] = useState(0)

  useImperativeHandle(
    ref,
    (): PreviewHandle => ({
      getCanvas: () => rendererRef.current?.getCanvas() ?? null,
      getRenderer: () => rendererRef.current,
    }),
    [],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Dirty flag gating the per-RAF work. While paused, the scene only changes
    // when the playhead or the project does — re-resolving and re-rendering at
    // 60 Hz regardless is pure GPU/CPU burn (GpuRenderer's Scene-identity
    // fast-path never hits because resolveTimeline allocates a fresh Scene
    // per call). Playback forces a full tick every frame.
    let dirty = true
    const markDirty = () => {
      dirty = true
    }

    const renderer = new GpuRenderer({
      probeLayer,
      demuxerFactory,
      preserveDrawingBuffer,
      ...(clearColor ? { clearColor } : {}),
      onContextLost: () => setGlState('lost'),
      onContextRestored: () => {
        setGlState('ok')
        markDirty()
      },
      onContextUnrecoverable: () => setGlState('failed'),
      // Clip-boundary events only (see RendererOptions), so this is a handful
      // of store writes per clip — not one per rendered frame.
      onClipLoad: (clipId, state) => clipLoadStore.getState().set(clipId, state),
    })
    renderer.mount(container)
    renderer.setDebug(debug)
    rendererRef.current = renderer
    setGlState('ok')

    const resize = () => {
      const dpr = window.devicePixelRatio ?? 1
      renderer.resize(container.clientWidth, container.clientHeight, dpr)
      markDirty()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()

    // Audio runs beside the renderer on the same playback clock — it self-drives
    // off playback.subscribe(), so there is nothing to call per RAF tick.
    const audio = enableAudio
      ? new AudioPlaybackController(playback, () => engine.getProject(), { audioResolver })
      : null
    audio?.start()

    // Warm the decode cache for remote audio (e.g. Freesound previews) and
    // images (e.g. Pexels/Pixabay) as soon as clips land on the timeline,
    // instead of waiting for first play/paint.
    //
    // Bound to the events that can actually introduce a source, not to
    // 'change'. 'change' also fires on every pointermove of a transform drag
    // (`previewClip`), and each one used to walk every clip on every track
    // twice — once for images, once for audio — to warm caches that could not
    // possibly have gained an entry from a clip being moved.
    let warmAudio: ((clip?: Clip) => void) | null = null
    let warmAudioOnLoad: (() => void) | null = null
    const warmImages = (clip?: Clip) => {
      if (clip) {
        if (clip.type === 'image' && typeof clip.src === 'string') warmImageSrc(clip.src)
        return
      }
      preloadProjectImages(engine.getProject())
    }
    // 'clip:updated' also fires per pointermove, but the per-clip branch above
    // is one map lookup — and it is the only signal that catches a clip being
    // repointed from a `blob:` URL to its hosted one after upload.
    const warmImagesOnLoad = () => warmImages()
    warmImages()
    engine.on('clip:added', warmImages)
    engine.on('clip:updated', warmImages)
    engine.on('project:loaded', warmImagesOnLoad)

    // Anything that can change the resolved Scene marks the loop dirty:
    // project edits, and any playback-store change (seeks, scrub epoch bumps,
    // play/pause). Store notifications are change-driven, not per-RAF.
    engine.on('change', markDirty)
    const unsubPlayback = usePlaybackStore.subscribe(markDirty)

    if (audio) {
      warmAudio = (clip?: Clip) => {
        if (clip) {
          if (clip.type === 'audio' && typeof clip.src === 'string') audio.warmAudioSrc(clip.src)
          return
        }
        audio.preloadProjectAudio()
      }
      warmAudioOnLoad = () => warmAudio?.()
      warmAudio()
      engine.on('clip:added', warmAudio)
      engine.on('clip:updated', warmAudio)
      engine.on('project:loaded', warmAudioOnLoad)
    }

    // Also warm as soon as an asset is *registered* (e.g. clicked into the
    // library from a stock panel), not only once it lands on the timeline as a
    // clip — otherwise the first play/paint after drag-drop still races a cold
    // fetch+decode of an asset that could have been warming for minutes already.
    const warmedAssetIds = new Set<string>()
    const unsubMediaLibrary = useMediaLibraryStore.subscribe((state) => {
      for (const id of state.order) {
        if (warmedAssetIds.has(id)) continue
        warmedAssetIds.add(id)
        const asset = state.assets[id]
        if (asset?.kind === 'audio') audio?.warmAudioSrc(asset.src)
        else if (asset?.kind === 'image') warmImageSrc(asset.src)
        // Video's cold start is the whole-file download the demuxer needs
        // before it can read a single frame — seconds for a gallery clip. Start
        // it at registration so a drop minutes later opens on cached bytes.
        else if (asset?.kind === 'video') warmVideoSrc(asset.src)
      }
    })

    let rafId = 0
    // How far ahead (in frames) to prewarm video decode. A cut from an image (or
    // any non-video clip) into a video otherwise starts decode cold at the
    // boundary — open + seek-to-keyframe + fill run AFTER the playhead crosses,
    // freezing on a black frame. Resolving the scene this many frames ahead and
    // pushing the upcoming clips' playhead lets their decoders warm up first.
    // ~1s at 30fps comfortably covers a cold WebCodecs open + keyframe seek.
    const PREWARM_HORIZON_FRAMES = 30
    // While paused, keep the decode horizon warm on a slow cadence (instead of
    // per-RAF) so VideoLayer's idle-eviction re-arm still sees upcoming clips
    // and Space-to-play doesn't start cold.
    const PAUSED_PREWARM_INTERVAL_MS = 500
    let lastPrewarmAt = 0

    // Silent until `__trace.on('PERF')`; see PerfSummary. Counts store
    // notifications alongside the tick cost, because a store that notifies on
    // every frame is the difference between a loop that is busy and one that is
    // dragging React along behind it.
    const perf = new PerfSummary()
    const unsubPerfPlayback = usePlaybackStore.subscribe(() => perf.count('playbackNotify'))
    const countTracks = () => perf.count('engineChange')
    engine.on('change', countTracks)
    const tick = () => {
      rafId = requestAnimationFrame(tick)
      // While the GL context is lost, resolving/prewarming only adds decode
      // pressure that competes with recovery — skip everything.
      if (renderer.isContextLost) return

      const playing = usePlaybackStore.getState().isPlaying
      const now = performance.now()
      const hasLoading = Object.values(clipLoadStore.getState().byClipId).some((s) => s === 'loading')
      // A seek is one dirty tick, but decode is async: the tick paints whatever
      // frame the cache already holds, and when the right one arrives nothing
      // marks the loop dirty again. Clicking the ruler therefore used to leave
      // the PREVIOUS seek's frame on screen until the user dragged or played.
      // `isAwaitingFrames` keeps the loop awake until the frame that was asked
      // for is the frame on screen (and gives up by itself if it never comes).
      if (!playing && !dirty && !hasLoading && !renderer.isAwaitingFrames) {
        // Idle: no scene change possible; just keep the prewarm horizon warm.
        if (now - lastPrewarmAt >= PAUSED_PREWARM_INTERVAL_MS) {
          lastPrewarmAt = now
          const frame = Math.floor(playback.getFrameAt())
          const project = engine.getProject()
          renderer.prewarm(resolveTimeline(frame + PREWARM_HORIZON_FRAMES, project))
        }
        return
      }
      dirty = false

      const frame = Math.floor(playback.getFrameAt())
      const project = engine.getProject()
      const scene = perf.measure('resolve', () => resolveTimeline(frame, project))
      // Capture snapshot before render — canvas still holds the previous frame.
      const canvas = renderer.getCanvas()
      if (canvas) transitionOverlayRef.current?.captureIfNewTransition(scene, canvas)
      perf.measure('render', () => renderer.render(scene))
      transitionOverlayRef.current?.update(scene)
      // Warm decoders for clips that will become active within the horizon so
      // image→video (and any cold) boundaries paint instantly instead of freezing.
      lastPrewarmAt = now
      perf.measure('prewarm', () => {
        const prewarmScene = resolveTimeline(frame + PREWARM_HORIZON_FRAMES, project)
        renderer.prewarm(prewarmScene)
      })

      // Measures the whole tick, not just the GPU: the complaint this exists to
      // settle is about the editor feeling slow, and the renderer's own FPS
      // counter cannot see the main-thread work competing with it.
      perf.endTick(performance.now() - now, { fps: renderer.fps })
    }
    rafId = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
      if (warmAudio) {
        engine.off('clip:added', warmAudio)
        engine.off('clip:updated', warmAudio)
      }
      if (warmAudioOnLoad) engine.off('project:loaded', warmAudioOnLoad)
      engine.off('clip:added', warmImages)
      engine.off('clip:updated', warmImages)
      engine.off('project:loaded', warmImagesOnLoad)
      engine.off('change', markDirty)
      unsubPlayback()
      unsubPerfPlayback()
      engine.off('change', countTracks)
      unsubMediaLibrary()
      audio?.destroy()
      renderer.dispose()
      rendererRef.current = null
      // The store is module-scoped: a 'loading' entry left behind here would
      // greet whatever preview mounts next with a spinner over nothing.
      clipLoadStore.getState().clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, playback, demuxerFactory, debug, probeLayer, preserveDrawingBuffer, enableAudio, audioResolver, reloadKey])

  return (
    <div
      ref={containerRef}
      className={cn('relative w-full h-full bg-[var(--elah-preview-bg,#06070A)]', className)}
      style={style}
    >
      {/* Project-frame outline, drawn at the same letterbox fit the renderer
          uses so the active aspect ratio is always visible against the bars. */}
      <StageBorder />

      {/* Transition snapshot layer — sits above the WebGL canvas (zIndex 1),
          below the interaction overlays. Driven imperatively from the RAF loop. */}
      <TransitionOverlay ref={transitionOverlayRef} />

      {/* Interactive transform layer for video/image clips (zIndex 2). Below
          ShapeOverlay/TextOverlay so synthetic elements win when they overlap. */}
      <MediaTransformOverlay />

      {/* Interactive transform layer for shape clips (zIndex 3). */}
      <ShapeOverlay />

      {/* Interactive text editing layer, painted above the WebGL canvas (zIndex 4). */}
      <TextOverlay />

      {/* Spinner while a clip's decoder opens — the window in which the canvas
          has nothing to paint and would otherwise just be black. */}
      <PreviewLoadingOverlay />

      {/* GPU context-loss recovery layer. 'lost' is transient (watchdog is
          trying to restore); 'failed' needs a manual remount. */}
      {glState !== 'ok' && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[var(--elah-overlay-scrim,rgba(0,0,0,0.7))] text-[color:var(--elah-overlay-text,#ffffff)] text-sm"
          data-testid="preview-gl-recovery"
        >
          {glState === 'lost' ? (
            <span>Recovering preview…</span>
          ) : (
            <>
              <span>The preview stopped rendering (graphics context lost).</span>
              <button
                type="button"
                className="rounded-md border border-[color:var(--elah-overlay-border,rgba(255,255,255,0.3))] bg-[var(--elah-overlay-bg,rgba(255,255,255,0.1))] px-3 py-1.5 hover:bg-[var(--elah-overlay-bg-hover,rgba(255,255,255,0.2))]"
                onClick={() => {
                  setGlState('ok')
                  setReloadKey((k) => k + 1)
                }}
              >
                Reload preview
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
})
