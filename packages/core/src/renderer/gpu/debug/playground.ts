/**
 * Renderer validation playground entry points.
 *
 * Mount a DebugGpuRenderer, optionally attach a DebugOverlay, and render
 * deterministic debug quads for manual GPU pipeline inspection.
 *
 * Usage:
 *   import { loadDebugScenario } from './gpu/debug/playground'
 *   const cleanup = loadDebugScenario(container, 'B', { showOverlay: true })
 *   // later: cleanup()
 */

import { DebugGpuRenderer } from './DebugGpuRenderer'
import { DebugOverlay } from './DebugOverlay'
import { GpuDebugCounters } from './GpuDebugCounters'
import { installGpuDebugGlobal, uninstallGpuDebugGlobal } from './GpuDebugGlobal'
import { loadScenario } from './scenarios'
import type { DebugRenderItem, DebugScenario } from './types'
import { DEBUG_STAGE } from './types'

export interface PlaygroundOptions {
  /** Logical stage dimensions. Defaults to 1280×720. */
  stage?: { width: number; height: number }
  /** Show DOM debug overlay (FPS, bounds, zIndex labels). Defaults to false. */
  showOverlay?: boolean
  /** Device pixel ratio for initial resize. Defaults to window.devicePixelRatio ?? 1. */
  dpr?: number
  /** Install window.__GPU_DEBUG__ with live counter snapshot. Defaults to false. */
  enableGpuDebug?: boolean
}

export interface PlaygroundHandle {
  /** Re-render with new items. */
  render(items: DebugRenderItem[]): void
  /** Resize the canvas backing store. */
  resize(cssWidth: number, cssHeight: number, dpr?: number): void
  /** Tear down renderer and overlay. */
  dispose(): void
}

/**
 * Mount the debug renderer, render items, and return a handle for further
 * updates. Also returns a dispose function for convenience.
 */
export function renderDebugScene(
  container: HTMLElement,
  items: DebugRenderItem[],
  options: PlaygroundOptions = {},
): PlaygroundHandle & (() => void) {
  const stage = options.stage ?? { ...DEBUG_STAGE }
  const dpr = options.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1)

  const renderer = new DebugGpuRenderer({ stage })
  renderer.mount(container)

  const cssWidth = container.clientWidth || stage.width
  const cssHeight = container.clientHeight || stage.height
  renderer.resize(cssWidth, cssHeight, dpr)
  renderer.render(items)

  let currentItems = items
  let overlay: DebugOverlay | null = null
  if (options.showOverlay) {
    overlay = new DebugOverlay(container, stage)
    overlay.update(items, 0, stage)
  }

  if (options.enableGpuDebug) {
    installGpuDebugGlobal(() => ({
      decoderStates: {},
      cacheSizes: {},
      textureCount: 0,
      activeClipIds: currentItems.map((item) => item.id),
      counters: GpuDebugCounters.snapshot(),
    }))
  }

  let lastFrameTime = typeof performance !== 'undefined' ? performance.now() : 0

  const handle: PlaygroundHandle = {
    render(nextItems: DebugRenderItem[]) {
      currentItems = nextItems
      const now = typeof performance !== 'undefined' ? performance.now() : 0
      const dt = now - lastFrameTime
      const fps = dt > 0 ? 1000 / dt : 0
      lastFrameTime = now

      renderer.render(nextItems)
      overlay?.update(nextItems, fps, stage)
    },

    resize(cssW: number, cssH: number, nextDpr?: number) {
      renderer.resize(cssW, cssH, nextDpr ?? dpr)
      renderer.render(currentItems)
      overlay?.update(currentItems, 0, stage)
    },

    dispose() {
      overlay?.dispose()
      overlay = null
      if (options.enableGpuDebug) {
        uninstallGpuDebugGlobal()
      }
      renderer.dispose()
    },
  }

  // Callable cleanup shorthand.
  const cleanup = () => handle.dispose()
  return Object.assign(cleanup, handle)
}

/**
 * Load a named validation scenario and render it in the given container.
 * Returns a handle with render/resize/dispose plus a callable cleanup fn.
 */
export function loadDebugScenario(
  container: HTMLElement,
  scenario: DebugScenario,
  options: PlaygroundOptions = {},
): PlaygroundHandle & (() => void) {
  const items = loadScenario(scenario)
  return renderDebugScene(container, items, options)
}

export { loadScenario } from './scenarios'
export type { DebugRenderItem, DebugScenario } from './types'
export { DEBUG_STAGE } from './types'
