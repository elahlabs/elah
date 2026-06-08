/**
 * Layer abstraction for the GPU renderer.
 *
 * A Layer encapsulates all GPU resources and draw logic for one class of
 * Scene item (video, image, text, effects, …). RenderGraph holds a registry
 * of Layer instances and drives them.
 *
 * Invariants:
 *  - Layers import ONLY from scene.ts, core/types, and browser APIs.
 *  - No React, no engine, no Zustand.
 *  - acquire/release are called by RenderGraph based on Scene diffing.
 *  - draw() is synchronous; async work happens out-of-band.
 */

/** Rendering context threaded through every draw call. */
export interface LayerContext {
  /** WebGL2 context. The context may be lost; layers must guard accordingly. */
  gl: WebGL2RenderingContext
  /** Logical stage dimensions — the coordinate space transforms are relative to. */
  stage: { width: number; height: number }
  /** Physical canvas backing-store dimensions in pixels (after DPR scaling). */
  viewport: { width: number; height: number }
  /** Frames-per-second from the Scene, used for source-time calculations. */
  fps: number
}

/**
 * A stateful draw unit that handles one kind of Scene item.
 *
 * @typeParam TItem  The Scene clip type this layer handles (e.g. ActiveVideoClip).
 */
export interface Layer<TItem = unknown> {
  /**
   * Called when an item enters the Scene (first frame it is active).
   * The layer should allocate any per-item GPU resources here.
   */
  acquire(item: TItem, ctx: LayerContext): void

  /**
   * Called when an item leaves the Scene (first frame it is no longer active).
   * The layer should start or immediately perform per-item cleanup.
   */
  release(itemId: string): void

  /**
   * Draw the item for the current frame. Called once per active item per tick.
   * Must not block; async work (decoding, uploading) fires out-of-band.
   */
  draw(item: TItem, ctx: LayerContext): void

  /** Dispose all GPU resources owned by this layer. */
  dispose(): void
}
