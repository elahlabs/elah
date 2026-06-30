'use client'

import { useEffect, useState } from 'react'
import { useTimelineEngine, type Clip } from '@elah/editor'
import { cn } from '@/lib/utils'
import { PANEL, PanelHeader, SliderRow } from './propertiesShared'

export function AudioClipProperties({ clip }: { clip: Clip }) {
  const engine = useTimelineEngine()
  const [local, setLocal] = useState<Partial<Clip>>({})

  useEffect(() => { setLocal({}) }, [clip.id])

  const effective = { ...clip, ...local }

  const commit = (updates: Partial<Clip>) => {
    setLocal((prev) => ({ ...prev, ...updates }))
    engine.updateClip(clip.id, clip.trackId, updates)
  }

  const startSec = (clip.startFrame / 30).toFixed(0)
  const endSec = ((clip.startFrame + clip.durationFrames) / 30).toFixed(0)

  return (
    <div className={cn(PANEL, 'overflow-hidden')}>
      <PanelHeader
        subtitle={`${clip.name} · 0:${startSec.padStart(2, '0')}–0:${endSec.padStart(2, '0')}`}
      />

      <div className="flex-1 overflow-auto p-4">
        <SliderRow
          label="Volume"
          value={effective.volume ?? 1}
          display={`${Math.round((effective.volume ?? 1) * 100)}%`}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => commit({ volume: v })}
        />
      </div>
    </div>
  )
}
