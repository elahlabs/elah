/**
 * GpuDebugGlobal — optional development-only `window.__GPU_DEBUG__` hook.
 *
 * Guarded for non-browser environments. No React or store coupling.
 */

import type { DecoderState } from '../VideoDecoderManager'
import type { CounterSnapshot } from './GpuDebugCounters'

export interface GpuDebugState {
  decoderStates: Record<string, DecoderState>
  cacheSizes: Record<string, number>
  textureCount: number
  activeClipIds: string[]
  counters: CounterSnapshot
}

declare global {
  interface Window {
    __GPU_DEBUG__?: GpuDebugState
  }
}

export function installGpuDebugGlobal(getState: () => GpuDebugState): void {
  if (typeof window === 'undefined') return

  Object.defineProperty(window, '__GPU_DEBUG__', {
    configurable: true,
    enumerable: true,
    get: getState,
  })
}

export function uninstallGpuDebugGlobal(): void {
  if (typeof window === 'undefined') return
  delete window.__GPU_DEBUG__
}
