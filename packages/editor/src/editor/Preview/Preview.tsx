import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
} from 'react'
import { GpuRenderer } from '@elah/core'
import { resolveTimeline } from '@elah/core'
import { useTimelineEngine, usePlaybackEngine, useMediaLibraryStore } from '@elah/react'
import type { DemuxerFactory } from '@elah/core'
import { AudioPlaybackController, preloadProjectImages, warmImageSrc } from '@elah/core'
import type { AudioResolver } from '@elah/core'
import { cn } from '@elah/timeline'
import { TextOverlay } from './TextOverlay'
import { ShapeOverlay } from './ShapeOverlay'
import { MediaTransformOverlay } from './MediaTransformOverlay'
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

    const renderer = new GpuRenderer({
      probeLayer,
      demuxerFactory,
      preserveDrawingBuffer,
      ...(clearColor ? { clearColor } : {}),
    })
    renderer.mount(container)
    renderer.setDebug(debug)
    rendererRef.current = renderer

    const resize = () => {
      const dpr = window.devicePixelRatio ?? 1
      renderer.resize(container.clientWidth, container.clientHeight, dpr)
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
    let warmAudio: (() => void) | null = null
    const warmImages = () => preloadProjectImages(engine.getProject())
    warmImages()
    engine.on('change', warmImages)

    if (audio) {
      warmAudio = () => audio.preloadProjectAudio()
      warmAudio()
      engine.on('change', warmAudio)
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
    const tick = () => {
      const frame = Math.floor(playback.getFrameAt())
      const project = engine.getProject()
      const scene = resolveTimeline(frame, project)
      // Capture snapshot before render — canvas still holds the previous frame.
      const canvas = renderer.getCanvas()
      if (canvas) transitionOverlayRef.current?.captureIfNewTransition(scene, canvas)
      renderer.render(scene)
      transitionOverlayRef.current?.update(scene)
      // Warm decoders for clips that will become active within the horizon so
      // image→video (and any cold) boundaries paint instantly instead of freezing.
      const prewarmScene = resolveTimeline(frame + PREWARM_HORIZON_FRAMES, project)
      renderer.prewarm(prewarmScene)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
      if (warmAudio) engine.off('change', warmAudio)
      engine.off('change', warmImages)
      unsubMediaLibrary()
      audio?.destroy()
      renderer.dispose()
      rendererRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, playback, demuxerFactory, debug, probeLayer, preserveDrawingBuffer, enableAudio, audioResolver])

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
    </div>
  )
})
