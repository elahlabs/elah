import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
} from 'react'
import { GpuRenderer } from '../../core/renderer/gpu/GpuRenderer'
import { resolveTimeline } from '../../core/resolver/resolveTimeline'
import { useTimelineEngine, usePlaybackEngine } from '../../core/editor-context'
import type { DemuxerFactory } from '../../core/media/video/demuxer/MediabunnyDemuxer'
import { AudioPlaybackController } from '../../core/media/audio/AudioPlaybackController'
import { TextOverlay } from './TextOverlay'
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
    style,
    className,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<GpuRenderer | null>(null)
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
      ? new AudioPlaybackController(playback, () => engine.getProject())
      : null
    audio?.start()

    let rafId = 0
    const tick = () => {
      const frame = Math.floor(playback.getFrameAt())
      const scene = resolveTimeline(frame, engine.getProject())
      renderer.render(scene)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
      audio?.destroy()
      renderer.dispose()
      rendererRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, playback, demuxerFactory, debug, probeLayer, preserveDrawingBuffer, enableAudio])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#000',
        ...style,
      }}
    >
      {/* Project-frame outline, drawn at the same letterbox fit the renderer
          uses so the active aspect ratio is always visible against the bars. */}
      <StageBorder />

      {/* Interactive text editing layer, painted above the WebGL canvas. The
          canvas is appended imperatively by GpuRenderer.mount(); this React
          child coexists with it inside the same positioned container. */}
      <TextOverlay />
    </div>
  )
})
