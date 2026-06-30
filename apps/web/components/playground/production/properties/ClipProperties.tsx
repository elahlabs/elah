'use client'

import { useSelectionStore, useTracksStore, type Clip } from '@elah/editor'
import { cn } from '@/lib/utils'
import { PANEL, PanelHeader } from './propertiesShared'
import { TextClipProperties } from './TextClipProperties'
import { VideoClipProperties } from './VideoClipProperties'
import { AudioClipProperties } from './AudioClipProperties'

function useSelectedClip(): Clip | null {
  const selectedClipIds = useSelectionStore((s) => s.selectedClipIds)
  const clips = useTracksStore((s) => s.clips)

  if (selectedClipIds.size !== 1) return null
  const [id] = selectedClipIds
  for (const trackClips of Object.values(clips)) {
    const clip = trackClips.find((c) => c.id === id)
    if (clip) return clip
  }
  return null
}

export function ClipProperties() {
  const clip = useSelectedClip()

  if (!clip) {
    return (
      <div className={cn(PANEL, 'overflow-hidden')}>
        <PanelHeader />
        <div className="flex-1 flex items-center justify-center p-6 text-center text-xs text-ed-text-muted">
          Select a clip to edit properties
        </div>
      </div>
    )
  }

  if (clip.type === 'text') return <TextClipProperties />
  if (clip.type === 'video' || clip.type === 'image') return <VideoClipProperties clip={clip} />
  if (clip.type === 'audio') return <AudioClipProperties clip={clip} />

  return null
}
