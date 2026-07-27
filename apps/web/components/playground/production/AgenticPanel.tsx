'use client'

import { useCallback, useRef, useState, type RefObject } from 'react'
import { Sparkles, Send, X } from 'lucide-react'
import { useTimelineEngine, type TimelineRef } from '@elah/editor'
import { loadPixabayTopic } from './loadRandomPixabay'
import type { TopicOption } from '@/lib/ai/types'
import posthog from 'posthog-js'

type PanelState = 'idle' | 'thinking' | 'choosing'

const SAMPLE_PROMPTS = [
  'Serene mountain sunrise',
  'Rainforest waterfall escape',
  'Product launch ad',
  'Brand story reel',
  'Ocean waves at golden hour',
  'Minimalist skincare promo',
  'Autumn forest walk',
  'Startup pitch teaser',
]

export interface AgenticPanelProps {
  style?: React.CSSProperties
  timelineRef: RefObject<TimelineRef | null>
  busy: boolean
  setBusy: (b: boolean) => void
}

export function AgenticPanel({ style, timelineRef, busy, setBusy }: AgenticPanelProps) {
  const engine = useTimelineEngine()
  const [state, setState] = useState<PanelState>('idle')
  const [prompt, setPrompt] = useState('')
  const [askedPrompt, setAskedPrompt] = useState('')
  const [options, setOptions] = useState<TopicOption[]>([])
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const disabled = busy || state === 'thinking' || state === 'choosing'

  const submit = useCallback(
    async (override?: string) => {
      const trimmed = (override ?? prompt).trim()
      if (!trimmed || disabled) return

      setPrompt('')
      setAskedPrompt(trimmed)
      setError('')
      setState('thinking')

      posthog.capture('agentic_prompt_submitted', { prompt_length: trimmed.length })

      try {
        const res = await fetch('/api/ai/topics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: trimmed }),
        })
        const data = await res.json()
        if (!res.ok || !Array.isArray(data.options) || data.options.length === 0) {
          setError(data.error ?? `Request failed (${res.status})`)
          setState('idle')
          return
        }
        setOptions(data.options)
        setState('choosing')
      } catch (err) {
        console.error('[playground] Failed to fetch Agentic AI topics:', err)
        setError(err instanceof Error ? err.message : 'Request failed.')
        setState('idle')
      }
    },
    [prompt, disabled],
  )

  const pickSample = useCallback(
    (sample: string) => {
      if (disabled) return
      void submit(sample)
    },
    [submit, disabled],
  )

  const dismiss = useCallback(() => {
    setOptions([])
    setState('idle')
  }, [])

  const pick = useCallback(
    async (option: TopicOption) => {
      setOptions([])
      setState('idle')
      setBusy(true)
      posthog.capture('agentic_topic_selected', { topic_name: option.name })
      console.log('[playground] Agentic AI topic chosen', {
        name: option.name,
        videotags: option.topic.videotags,
        imagetags: option.topic.imagetags,
      })
      try {
        await loadPixabayTopic({
          engine,
          timelineRef,
          topicName: option.name,
          topic: { ...option.topic, musicQuery: '' },
        })
      } catch (err) {
        console.error('[playground] Failed to compose Agentic AI project:', err)
        setError(err instanceof Error ? err.message : 'Could not compose the project — check the console for details.')
      } finally {
        setBusy(false)
      }
    },
    [engine, timelineRef, setBusy],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void submit()
      }
    },
    [submit],
  )

  return (
    <div className="flex h-full flex-col bg-ed-panel text-ed-text" style={style}>
      <div className="flex items-center gap-2 border-b border-ed-border px-3.5 py-2.5">
        <Sparkles size={14} className="text-ed-error" />
        <span className="text-[13px] font-semibold">Agentic AI</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-3">
        {!askedPrompt && !error && (
          <p className="text-[11px] leading-relaxed text-ed-text-muted">
            Describe the video you want to create. I&apos;ll plan stock footage and captions —
            then compose it on the timeline.
          </p>
        )}

        <details open={!askedPrompt} className="group">
          <summary className="cursor-pointer select-none text-[10px] font-semibold tracking-wide text-ed-text-muted hover:text-ed-text">
            SAMPLE IDEAS
          </summary>
          <div className="flex flex-wrap gap-1.5 pt-1.5">
            {SAMPLE_PROMPTS.map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => pickSample(sample)}
                disabled={disabled}
                className="rounded-full border border-ed-border bg-ed-elevated px-2.5 py-1 text-[11px] text-ed-text-muted transition-colors hover:border-[var(--elah-color-error)] hover:text-ed-text disabled:opacity-50"
              >
                {sample}
              </button>
            ))}
          </div>
        </details>

        {askedPrompt && (
          <div className="self-end max-w-[90%] rounded-lg border border-ed-border bg-ed-elevated px-2.5 py-1.5 text-[12px]">
            {askedPrompt}
          </div>
        )}

        {state === 'thinking' && (
          <div className="flex items-center gap-2 text-[11px] text-ed-text-muted">
            <span
              className="h-3 w-3 rounded-full border-2 border-white/20 animate-spin"
              style={{ borderTopColor: 'var(--elah-danger-text)' }}
            />
            Planning directions…
          </div>
        )}

        {state === 'choosing' && options.length > 0 && (
          <div className="rounded-lg border border-ed-border bg-ed-bg-2 p-2.5">
            <div className="flex items-center justify-between pb-2">
              <span className="text-[10px] font-semibold tracking-wide text-ed-text-muted">
                PICK A DIRECTION
              </span>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Dismiss options"
                className="inline-flex items-center justify-center w-5 h-5 rounded text-ed-text-muted hover:text-ed-text transition-colors"
              >
                <X size={13} />
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              {options.map((option, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => void pick(option)}
                  className="rounded-md border border-ed-border bg-ed-elevated px-2.5 py-2 text-left transition-colors hover:border-[var(--elah-color-error)]"
                >
                  <div className="text-[12px] font-medium text-ed-text">{option.name}</div>
                  <div className="truncate text-[11px] text-ed-text-muted">
                    {option.topic.videotags.join(' · ')}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-2 text-[11px] text-ed-text-muted">
            <span
              className="h-3 w-3 rounded-full border-2 border-white/20 animate-spin"
              style={{ borderTopColor: 'var(--elah-danger-text)' }}
            />
            Composing your project on the timeline…
          </div>
        )}

        {error && <p className="text-[11px] text-ed-error">{error}</p>}
      </div>

      <div className="border-t border-ed-border p-3">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={state === 'choosing' ? 'Pick a direction above…' : 'What do you want to create?'}
            className="min-w-0 flex-1 rounded-md border border-ed-border bg-ed-bg-2 px-2.5 py-1.5 text-[12px] placeholder:text-ed-text-muted focus:border-[var(--elah-color-error)] focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={disabled || !prompt.trim()}
            aria-label="Send"
            className="inline-flex items-center justify-center w-[30px] h-[30px] shrink-0 rounded-md bg-ed-error text-white disabled:opacity-40"
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
