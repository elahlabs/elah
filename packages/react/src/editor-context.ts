import { createContext, useContext } from 'react'
import type { TimelineEngine, PlaybackEngine } from '@elah/core'

/** The engine pair every editor hook reads from — the React bridge to core's framework-agnostic classes. */
export interface EditorContextValue {
  engine: TimelineEngine
  playback: PlaybackEngine
}

/** Nullable by default so useEditor can detect and reject use outside an EditorProvider. */
export const EditorContext = createContext<EditorContextValue | null>(null)

/** Throws instead of returning null so a misplaced hook fails loudly at render, not later with an undefined engine. */
export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext)
  if (!ctx) throw new Error('useEditor must be used inside <EditorProvider>')
  return ctx
}

/** Convenience accessor for the timeline engine alone, for components that never touch playback. */
export const useTimelineEngine = (): TimelineEngine => useEditor().engine
/** Convenience accessor for the playback engine alone, for transport controls that never mutate the timeline. */
export const usePlaybackEngine = (): PlaybackEngine => useEditor().playback
