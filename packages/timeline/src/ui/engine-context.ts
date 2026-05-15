import { createContext, useContext } from 'react'
import type { TimelineEngine } from '../core/editor/TimelineEngine'

export const EngineContext = createContext<TimelineEngine | null>(null)

/**
 * Access the TimelineEngine instance from anywhere inside a <Timeline />.
 *
 * @example
 * ```ts
 * function Controls() {
 *   const engine = useTimeline()
 *   return <button onClick={() => engine.undo()}>Undo</button>
 * }
 * ```
 */
export function useTimeline(): TimelineEngine {
  const engine = useContext(EngineContext)
  if (!engine) {
    throw new Error(
      'useTimeline() must be called inside a <Timeline /> component tree.',
    )
  }
  return engine
}
