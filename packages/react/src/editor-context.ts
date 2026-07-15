import { createContext, useContext } from 'react'
import type { TimelineEngine, PlaybackEngine } from '@elah/core'

export interface EditorContextValue {
  engine: TimelineEngine
  playback: PlaybackEngine
}

export const EditorContext = createContext<EditorContextValue | null>(null)

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext)
  if (!ctx) throw new Error('useEditor must be used inside <EditorProvider>')
  return ctx
}

export const useTimelineEngine = (): TimelineEngine => useEditor().engine
export const usePlaybackEngine = (): PlaybackEngine => useEditor().playback
