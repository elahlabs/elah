'use client'

import { useEffect, useState } from 'react'
import { useTimelineEngine, type Clip } from '@elah/editor'
import type { BaselineContext } from '@elah/core'
import { cn } from '@/lib/utils'
import { PANEL, PanelHeader, SliderRow } from './propertiesShared'
import { useKeyframeEditing } from './useKeyframeEditing'
import { AnimatePanel, animatableChannels } from './AnimatePanel'

type Tab = 'audio' | 'animate'
const TABS: { id: Tab; label: string }[] = [
  { id: 'audio', label: 'Audio' },
  { id: 'animate', label: 'Animate' },
]

export function AudioClipProperties({ clip }: { clip: Clip }) {
  const engine = useTimelineEngine()
  const [local, setLocal] = useState<Partial<Clip>>({})
  const [tab, setTab] = useState<Tab>('audio')

  useEffect(() => { setLocal({}) }, [clip.id])

  // Audio has no picture to place, so the baseline is just the stage. Volume is
  // the one channel an audio clip animates.
  const kfCtx: BaselineContext = { stage: engine.getProject().stage }
  const { scalar, commitScalar, diamond } = useKeyframeEditing(clip, local, setLocal, kfCtx)

  const startSec = (clip.startFrame / 30).toFixed(0)
  const endSec = ((clip.startFrame + clip.durationFrames) / 30).toFixed(0)

  return (
    <div className={cn(PANEL, 'overflow-hidden')}>
      <PanelHeader
        subtitle={`${clip.name} · 0:${startSec.padStart(2, '0')}–0:${endSec.padStart(2, '0')}`}
      />

      <div className="flex items-center gap-4 px-4 border-b border-ed-border shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'relative py-2.5 text-[13px] transition-colors',
              tab === t.id ? 'text-ed-text' : 'text-ed-text-muted hover:text-ed-text',
            )}
          >
            {t.label}
            {tab === t.id && (
              <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-ed-accent rounded-full" />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tab === 'audio' && (
          <SliderRow
            label="Volume"
            action={diamond('Volume', ['volume'], { volume: scalar('volume', 1) })}
            value={scalar('volume', 1)}
            display={`${Math.round(scalar('volume', 1) * 100)}%`}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => commitScalar('volume', v)}
          />
        )}

        {tab === 'animate' && (
          <AnimatePanel clip={clip} ctx={kfCtx} channels={animatableChannels(clip)} />
        )}
      </div>
    </div>
  )
}
