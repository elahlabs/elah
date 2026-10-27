import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Send } from 'lucide-react'
import { getCap, type CommentsCap, type CanSend } from './claudeCaps'

/** Fixed sentences: each is the whole request Claude receives. */
export const FOLLOW_UPS: { id: string; label: string; text: string }[] = [
  { id: 'shorter', label: 'Shorter', text: 'Make a shorter cut of this video, about half the length, same look.' },
  { id: 'vertical', label: 'Vertical', text: 'Make a vertical 9:16 version of this video (1080x1920), same look and message.' },
  { id: 'square', label: 'Square', text: 'Make a square 1:1 version of this video (1080x1080), same look and message.' },
  { id: 'look', label: 'Another look', text: 'Give this video a different look (another style and palette), same message and length.' },
  { id: 'colour', label: 'Another colour', text: 'Change the accent colour of this video to a different one that suits the brand, keep everything else.' },
  { id: 'calmer', label: 'Calmer', text: 'Make this video calmer: slower pacing, gentler motion, softer transitions.' },
  { id: 'bolder', label: 'Bolder', text: 'Make this video bolder: punchier pacing, larger type, stronger motion.' },
]

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.append(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

/** One-click variations. Sends to Claude only on the viewer's own click, and only when the shell says it can. */
export function FollowUps() {
  const [can, setCan] = useState<CanSend | 'none'>('none')
  const [note, setNote] = useState('')
  const [cool, setCool] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const check = useCallback(async () => {
    const c = await getCap<CommentsCap>('comments')
    if (!c || typeof c.canSendToClaude !== 'function') return setCan('none')
    try {
      setCan(await c.canSendToClaude())
    } catch {
      setCan('none')
    }
  }, [])

  useEffect(() => {
    void check()
    const onVis = () => { if (!document.hidden) void check() }
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); window.clearTimeout(timer.current) }
  }, [check])

  const fallback = async (text: string) => {
    const ok = await copyText(text)
    setNote(ok ? 'Copied. Paste this to Claude in your terminal.' : `Paste this to Claude in your terminal: ${text}`)
  }

  const press = async (el: Element, text: string) => {
    if (cool) return
    if (can !== 'available') return fallback(text)
    const c = await getCap<CommentsCap>('comments')
    if (!c || typeof c.sendToClaude !== 'function' || typeof c.anchorFor !== 'function') return fallback(text)
    try {
      const anchor = await c.anchorFor(el)
      await c.sendToClaude({ anchor, text })
      setNote('Sent to Claude. It will update this video at the same link.')
    } catch (e) {
      const code = (e as { code?: string } | null)?.code
      if (code === 'rate_limited') {
        setCool(true)
        setNote('Too many requests. Try again in a moment.')
        timer.current = window.setTimeout(() => { setCool(false); setNote('') }, 30_000)
      } else {
        void check()
        await fallback(text)
      }
    }
  }

  const send = can === 'available'
  return (
    <section className="followups" aria-label="Ask for a variation" data-testid="followups" data-send={send ? '1' : '0'}>
      <span className="row-lbl">Ask for a variation</span>
      <div className="chips">
        {FOLLOW_UPS.map((f) => (
          <button key={f.id} type="button" className="chip" disabled={cool} data-testid={`followup-${f.id}`}
            title={send ? 'Send this request to Claude' : 'Copy this request, then paste it to Claude'} onClick={(e) => void press(e.currentTarget, f.text)}>
            {send ? <Send size={12} /> : <Copy size={12} />} {f.label}
          </button>
        ))}
      </div>
      {note && <span className="row-note" role="status" data-testid="followup-note">{note}</span>}
    </section>
  )
}
