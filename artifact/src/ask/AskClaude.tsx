/**
 * TICKET-PF-17 (phase A): "Ask Claude" in the editor sidebar. The request goes to `sample` on the VIEWER's own
 * Claude account with the page tools from `tools.ts`; Claude's edits land live on the timeline and fold into one
 * undo step when the answer ends. Rendered only where `claude.use('sample')` resolves a function whose view can
 * run tools; null (locally, always) renders nothing. Calls happen only on the viewer's Ask; never at load.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, Square } from 'lucide-react'
import { usePlaybackStore, useSelectionStore, useTimelineEngine, useTracksStore } from '@elah/editor'
import { getCap, type SampleCap, type SampleError, type SampleTier } from '../claudeCaps'
import { buildAskPrompt } from './prompt'
import { createAskSession } from './tools'

/** Codes after which the feature is hidden for this view (sample.d.ts: permanent, never re-ask). */
const HIDE = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'tools_unavailable'])

function copyFor(code: string): string {
  switch (code) {
    case 'rate_limited':
      return 'Too many requests to Claude right now. Try again in a little while.'
    case 'session_expired':
      return 'Sign in to Claude again, then try again.'
    case 'refused':
      return 'Claude declined this request. Try asking differently.'
    case 'empty_completion':
      return 'Claude returned nothing. Try a simpler request.'
    case 'prompt_too_large':
      return 'This project is too large to send to Claude.'
    case 'invalid_request':
    case 'transform_error':
    case 'queue_overflow':
      return 'The request could not be sent.'
    default:
      return 'Claude could not be reached. Try again.'
  }
}

/** The last paragraph of the answer: earlier rounds' narration sits above it. */
const lastLine = (text: string) => text.trim().split(/\n\s*\n/).pop()?.trim() ?? ''

interface AskLog {
  request: string
  ms: number
  tier: SampleTier
  tierApplied?: string
  steps: number
  oneUndo: boolean
  code?: string
  reply: string
}

export function AskClaude({ title }: { title: string }) {
  const engine = useTimelineEngine()
  const [sample, setSample] = useState<SampleCap | null>(null)
  const [hidden, setHidden] = useState(false)
  const [request, setRequest] = useState('')
  const [running, setRunning] = useState(false)
  const [line, setLine] = useState('')
  const [meta, setMeta] = useState('')
  const ctlRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let live = true
    void getCap<SampleCap>('sample').then(async (cap) => {
      if (typeof cap !== 'function') return
      if (typeof cap.limits === 'function') {
        // Cheap and local: no usage, no prompt. A view that cannot run page tools gets no box.
        const lim = await cap.limits().catch(() => null)
        if (!lim || !lim.tools) return
      }
      if (live) setSample(() => cap)
    })
    return () => {
      live = false
    }
  }, [])
  useEffect(() => () => ctlRef.current?.abort(), [])

  const ask = useCallback(async () => {
    const req = request.trim()
    if (!sample || running || !req) return
    const ctl = new AbortController()
    ctlRef.current = ctl
    usePlaybackStore.getState().pause()
    setRunning(true)
    setLine('Thinking...')
    setMeta('')
    const t0 = performance.now()
    const session = createAskSession(engine, (p) => setLine(p))
    const fps = engine.getProject().fps
    const prompt = buildAskPrompt(req, {
      title,
      project: engine.getProject(),
      playhead: usePlaybackStore.getState().currentFrame / fps,
      selected: [...useSelectionStore.getState().selectedClipIds],
      totalFrames: Math.max(1, useTracksStore.getState().totalFrames || engine.getTotalFrames()),
    })
    let answer = ''
    let tier: SampleTier = 'quick'
    let tierApplied: string | undefined
    let err: SampleError | null = null
    const call = (modelTier: SampleTier) =>
      sample(prompt, {
        tools: session.tools,
        modelTier,
        signal: ctl.signal,
        onText: ({ text }) => {
          answer = text
          const l = lastLine(text)
          if (l) setLine(l)
        },
      })
    try {
      let r = await call('quick')
      answer = r.text
      tierApplied = r.modelTierApplied
      // The quick tier sometimes answers without calling a tool; one try on the default tier, never more.
      if (session.applied.length === 0 && !ctl.signal.aborted) {
        tier = 'default'
        setLine('Thinking harder...')
        r = await call('default')
        answer = r.text
        tierApplied = r.modelTierApplied
      }
    } catch (e) {
      err = e && typeof e === 'object' && 'code' in e ? (e as SampleError) : { code: 'upstream_error', message: String(e) }
      if (err.code !== 'refused' && err.text) answer = err.text
    }
    const { steps, folded } = session.finish()
    const ms = Math.round(performance.now() - t0)
    const secs = (ms / 1000).toFixed(1)
    const changes = steps === 0 ? 'no change made' : `${steps} change${steps === 1 ? '' : 's'}, ${folded ? 'one undo step' : `${steps} undo steps (the timeline changed while Claude worked)`}`
    ctlRef.current = null
    setRunning(false)
    const log: AskLog = { request: req, ms, tier, tierApplied, steps, oneUndo: steps > 0 && folded, reply: lastLine(answer), ...(err ? { code: err.code } : {}) }
    const w = window as unknown as { __elahAsk?: AskLog[] }
    ;(w.__elahAsk ??= []).push(log)
    if (!err) {
      setLine(lastLine(answer) || 'Done.')
      setMeta(`${secs} s · ${changes}`)
      if (steps > 0) setRequest('')
      return
    }
    if (HIDE.has(err.code)) {
      // The viewer (or their organisation) declined, or this view cannot run tools: hide the box for this view.
      if (steps === 0) {
        setHidden(true)
        return
      }
    }
    if (err.code === 'cancelled') {
      setLine(steps ? 'Stopped. What Claude already changed stays; Undo reverts it.' : 'Stopped.')
    } else {
      setLine(copyFor(err.code))
      if (err.code === 'invalid_request' || err.code === 'transform_error') console.warn('[elah] Ask Claude:', err.message)
    }
    setMeta(`${secs} s · ${changes}`)
  }, [sample, running, request, engine, title])

  const stop = useCallback(() => ctlRef.current?.abort(), [])

  if (!sample || hidden) return null
  return (
    <section className="ask" aria-label="Ask Claude" data-testid="ask-claude">
      <label className="ask-h" htmlFor="ask-input">
        <Sparkles size={14} aria-hidden /> Ask Claude to edit
      </label>
      <textarea
        id="ask-input"
        className="ask-input"
        rows={2}
        maxLength={600}
        placeholder="Cut the pause at 0:12, make the headline bigger, slow the intro..."
        value={request}
        disabled={running}
        onChange={(e) => setRequest(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void ask()
          }
        }}
      />
      <div className="ask-row">
        {running ? (
          <button type="button" className="btn" onClick={stop} data-testid="ask-stop">
            <Square size={12} fill="currentColor" /> Stop
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={() => void ask()} disabled={!request.trim()} data-testid="ask-go">
            Ask
          </button>
        )}
        <span className="ask-note">Uses your Claude usage. Undo reverts each answer.</span>
      </div>
      {(line || meta) && (
        <p className="ask-out" role="status" aria-live="polite" data-testid="ask-out">
          {line}
          {meta && <span className="ask-meta">{meta}</span>}
        </p>
      )}
    </section>
  )
}
