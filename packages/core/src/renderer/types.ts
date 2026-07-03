import type { Scene } from '../resolver/scene'

/**
 * Contract every renderer implements.
 *
 * The renderer reads ONLY the Scene it is given. It never touches Project,
 * Track, Clip, MediaLibrary, or any engine directly. All domain logic lives
 * upstream in resolveTimeline; the renderer is a pure output sink.
 *
 * Lifecycle:
 *   1. Construct the renderer.
 *   2. Call `mount(container)` exactly once to attach it to the DOM.
 *   3. Call `render(scene)` on every frame tick (or whenever the Scene changes).
 *   4. Call `dispose()` on unmount. After dispose, mount/render must not be called.
 *
 * Known implementations (planned):
 *   - DomRenderer  (PR-10) — <video> stack + DOM text + <img> elements
 *   - CanvasRenderer (later) — drawImage from <video> to 2D canvas
 *   - GpuRenderer (later)   — WebGL/WebGPU texture pipeline
 *   - ExportRenderer (later) — Worker + VideoEncoder (off-main-thread)
 */
export interface Renderer {
  /** Attach the renderer to a DOM element. May be called once per instance. */
  mount(container: HTMLElement): void
  /**
   * Notify the renderer that the host container's CSS size has changed.
   * The renderer updates the canvas backing-store dimensions and GL viewport.
   * `Scene.stage` is the logical coordinate space; `resize` controls the
   * physical pixel size. The renderer fits stage into canvas (contain/letterbox).
   *
   * @param cssWidth  Container width in CSS pixels.
   * @param cssHeight Container height in CSS pixels.
   * @param dpr       Device pixel ratio (defaults to 1).
   */
  resize(cssWidth: number, cssHeight: number, dpr?: number): void
  /**
   * Render a single scene. Idempotent: calling with the same Scene reference
   * is a no-op (implementations may check reference equality to skip work).
   */
  render(scene: Scene): void
  /**
   * Prewarm decode for a future scene without drawing it.
   *
   * Given a Scene resolved a short horizon AHEAD of the current playhead, the
   * renderer acquires providers for any video clips that will soon be active and
   * pushes their playhead so the decoder opens, seeks to a keyframe, and fills
   * its lookahead buffer BEFORE the clip enters the visible scene. Without this,
   * a cut from a non-video clip (e.g. an image) into a video starts decode cold
   * at the boundary — a freeze / black flash while open+seek+decode catch up.
   *
   * Never draws, never uploads a texture. Optional: implementations without a
   * decode pipeline may no-op.
   */
  prewarm?(scene: Scene): void
  /** Tear down all resources. After dispose, mount and render must not be called. */
  dispose(): void
}
