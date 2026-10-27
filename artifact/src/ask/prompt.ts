/**
 * TICKET-PF-17: the memoryless input for one Ask. `sample` sees only this string (no system prompt the page
 * controls), so it carries the rules, a compact summary of the project and the viewer's request.
 */
import { baselineTransform, type Clip, type Project } from '@elah/core'
import { restValue } from './tools'

const MAX_CLIPS = 300
const MAX_TEXT = 90

const n2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2)
const n3 = (v: number) => (Math.round(v * 1000) / 1000).toString()

function clean(s: string, max = MAX_TEXT): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return JSON.stringify(one.length > max ? `${one.slice(0, max - 1)}…` : one)
}

/** The named beat (a chapter or a named marker) a clip starts in, if the project has any. */
function beatAt(project: Project, frame: number): string | undefined {
  let name: string | undefined
  for (const m of project.markers ?? []) {
    if (m.kind === 'beat' || !m.name?.trim()) continue
    if (m.frame <= frame) name = m.name.trim()
    else break
  }
  return name
}

function clipLine(project: Project, c: Clip, trackName: string): string {
  const fps = project.fps
  const parts = [c.id, c.type, `${n2(c.startFrame / fps)}-${n2((c.startFrame + c.durationFrames) / fps)}s`]
  if (c.type === 'text' && c.content) parts.push(`text ${clean(c.content)}`)
  else if (c.name) parts.push(`name ${clean(c.name, 40)}`)
  const base = baselineTransform(c, { stage: project.stage })
  if (base && c.type !== 'audio') {
    const box = `x ${n3(restValue(c, 'x', base))} y ${n3(restValue(c, 'y', base))} scale ${n2(restValue(c, 'scale', base))}`
    const keyed = (['x', 'y', 'scale'] as const).some((ch) => c.keyframes?.channels?.[ch]?.keys?.length)
    parts.push(keyed ? `${box} (animated, settles here)` : box)
  }
  if (c.type === 'text' && c.fontSize) parts.push(`size ${Math.round(c.fontSize)}px`)
  if (c.layout && (c.layout.anchorTo || c.layout.fitTo || c.layout.region || c.layout.pin)) parts.push('placed by layout')
  const beat = c.partId ?? beatAt(project, c.startFrame)
  if (beat) parts.push(`beat ${clean(beat, 40)}`)
  parts.push(`track ${clean(trackName, 30)}`)
  return parts.join(' | ')
}

export interface PromptContext {
  title: string
  project: Project
  /** Playhead, seconds. */
  playhead: number
  selected: string[]
  totalFrames: number
}

export function buildAskPrompt(request: string, ctx: PromptContext): string {
  const { project } = ctx
  const fps = project.fps
  const tracks = [...project.tracks].sort((a, b) => a.order - b.order)
  const lines: string[] = []
  let count = 0
  for (const t of tracks) {
    for (const c of project.clips[t.id] ?? []) {
      if (count++ >= MAX_CLIPS) break
      lines.push(clipLine(project, c, t.name || t.id))
    }
  }
  const more = count > MAX_CLIPS ? `\n(${count - MAX_CLIPS} more clips not listed)` : ''
  const selected = ctx.selected.length ? ctx.selected.join(', ') : 'none'
  return [
    'You are editing a short video in the Elah editor on this page. Carry out the viewer\'s request by calling the tools.',
    '',
    'Rules:',
    '- Change the video ONLY with the tools. Make every change the request asks for and nothing else; then stop.',
    '- Times are seconds on the timeline. x and y are fractions of the stage (0.5 = centre; y grows downward); scale 1 = the size it was made at.',
    '- "Bigger" or "smaller" without a number means scale x1.25 or x0.8 of the current value. "Slow" or "longer" without a number means 1.5x the current duration; "faster" or "shorter" means 0.67x.',
    '- "This", "it" or "the selected clip" means the selected clip. "The headline" is the largest or most prominent text.',
    '- To cut a pause, find the stretch where nothing starts or ends and remove it with trim_gap.',
    '- If a tool returns an error, fix the call or say why it cannot be done. If the request needs something the tools cannot do (colour, fonts, new clips, deleting), change nothing and say so.',
    '- Your final answer is ONE short line saying what changed, no lists or markdown.',
    '',
    `Video: ${clean(ctx.title, 80)}, ${project.stage.width}x${project.stage.height}, ${fps} fps, ${n2(ctx.totalFrames / fps)} s long.`,
    `Playhead: ${n2(ctx.playhead)} s. Selected: ${selected}.`,
    'Clips (id | kind | start-end | text or name | settled position | font size | beat | track):',
    lines.join('\n') + more,
    '',
    `Request: ${request.trim()}`,
  ].join('\n')
}
