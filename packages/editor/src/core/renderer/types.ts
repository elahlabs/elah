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
   * Render a single scene. Idempotent: calling with the same Scene reference
   * is a no-op (implementations may check reference equality to skip work).
   */
  render(scene: Scene): void
  /** Tear down all resources. After dispose, mount and render must not be called. */
  dispose(): void
}
