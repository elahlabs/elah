/**
 * `describeOp` (EDX-P11): one plain sentence per op, for the plan card and
 * the receipt — "Add lower third 'Priya, Founder' at 0:03 for 4s". Written
 * for an editor reading fast, so it names clips by name and times as m:ss.
 */

import type { Project } from '../types'
import { parseClipPath } from '../composition/paths'
import { locateClip } from './nested'
import { EFFECT_REGISTRY } from '../effects/registry'
import { EFFECT_BUNDLES } from '../effects/bundles'
import { GENERATOR_REGISTRY } from '../generators/registry'
import { getTransitionDefinition } from '../transitions/registry'
import { SPEED_PRESETS } from '../elements/speedPresets'
import type { EditorOp } from './types'
import { IMAGE_DEFAULT_SECONDS } from './imageDefaults'

/** Seconds as `m:ss` (or `m:ss.s` when there is a fraction worth showing). */
export function formatSeconds(sec: number): string {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  const whole = Math.floor(rest)
  const tenth = Math.round((rest - whole) * 10)
  return `${m}:${String(whole).padStart(2, '0')}${tenth && tenth < 10 ? `.${tenth}` : ''}`
}

function dur(sec: number): string {
  return sec >= 10 ? `${Math.round(sec)}s` : `${Math.round(sec * 10) / 10}s`
}

const human = (s: string) => s.replace(/-/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()

/** A channel as the card should read it: an effect id is a handle, not a word (AGN-P21). */
function channelName(c: string): string {
  const fx = /^fx\.[^.\s]+\.([^.\s]+)$/.exec(c)
  if (fx) return `${human(fx[1]!)} (effect)`
  if (c === 'shape.fill') return 'fill colour'
  if (c === 'shape.stroke') return 'stroke colour'
  if (c === 'shape.path') return 'path morph'
  if (c === 'color') return 'text colour'
  if (c.startsWith('mask.')) return `mask ${c.slice(5)}`
  if (c.startsWith('gen.')) return `${human(c.slice(4))} (generator)`
  return human(c)
}

/** A describer bound to a project, so clip ids read as names. */
export function opDescriber(
  project: Pick<Project, 'clips'> & Partial<Pick<Project, 'tracks' | 'markers' | 'transitions' | 'fps'>>,
  /** Library names, so `insertSourceRange` reads as the footage rather than its id. */
  assets?: ReadonlyMap<string, { name: string }>,
) {
  const names = new Map<string, string>()
  const effectKinds = new Map<string, string>()
  for (const list of Object.values(project.clips)) {
    for (const c of list) {
      names.set(c.id, c.name)
      for (const e of c.effects ?? []) effectKinds.set(`${c.id}/${e.id}`, e.kind)
    }
  }
  /** AGT-4b: a lane or a marker by id, as the user reads it. Falls back to what the op carried. */
  const trackName = (ref: string) => `“${(project.tracks ?? []).find((t) => t.id === ref)?.name ?? ref}”`
  const markerName = (ref: string) => {
    const m = (project.markers ?? []).find((x) => x.id === ref)
    return m ? (m.name ? `marker “${m.name}”` : `the marker at ${formatSeconds(m.frame / (project.fps && project.fps > 0 ? project.fps : 30))}`) : `marker “${ref}”`
  }
  /** A part inside a compound reads as its name and the graphic it is in (EG-P4). */
  const partName = (ref: string): string | undefined => {
    const segs = parseClipPath(ref)
    if (!segs || segs.length < 2) return undefined
    const root = Object.values(project.clips).flat().find((c) => c.id === segs[0])
    const inner = root?.type === 'compound' ? root.compound?.project : undefined
    if (!root || !inner) return undefined
    const found = locateClip({ clips: inner.clips, tracks: inner.tracks ?? [] }, segs.slice(1))
    return found.ok ? `“${found.clip.name}” in “${root.name}”` : undefined
  }
  const clip = (ref: string) => (ref.startsWith('$') ? `the new ${ref.slice(1)}` : names.has(ref) ? `“${names.get(ref)}”` : partName(ref) ?? `“${ref}”`)

  return function describeOp(op: EditorOp): string {
    switch (op.op) {
      case 'addText':
        return `Add text “${op.text}” at ${formatSeconds(op.at)} for ${dur(op.duration)}${op.motion ? ` · ${human(op.motion)}` : ''}${op.reveal ? ` · ${human(op.reveal)} reveal` : ''}`
      case 'addShape':
        return `Add ${op.drawOn ? 'a self-drawing ' : 'a '}${op.kind} at ${formatSeconds(op.at)} for ${dur(op.duration)}${op.region ? ` (${op.region})` : ''}`
      case 'addGenerator': {
        const def = GENERATOR_REGISTRY.get(op.kind)
        const preset = def?.presets?.find((p) => p.id === op.preset)?.label
        return `Add ${preset ?? def?.label ?? op.kind}${op.under !== undefined ? ` behind ${clip(op.under)}` : ''}${op.at !== undefined ? ` at ${formatSeconds(op.at)}` : ''}${op.duration !== undefined ? ` for ${dur(op.duration)}` : op.under !== undefined ? ' for its whole length' : ''}`
      }
      case 'addLowerThird':
        return `Add lower third “${op.title}${op.subtitle ? ` — ${op.subtitle}` : ''}” at ${formatSeconds(op.at)} for ${dur(op.duration)}`
      case 'addTitleCard':
        return `Add title card “${op.title}” at ${formatSeconds(op.at)} for ${dur(op.duration)}`
      case 'addCallout':
        return `Add callout “${op.text}” at ${formatSeconds(op.at)} for ${dur(op.duration)}`
      case 'setCaptionStyle':
        return op.mode === 'static' ? 'Make captions static' : `Style captions as ${op.mode === 'reveal' ? 'word by word' : op.mode}`
      case 'removeClip':
        return `Remove ${clip(op.clip)}`
      case 'moveClip':
        return `Move ${clip(op.clip)} to ${formatSeconds(op.at)}`
      case 'trimClip':
        return `Trim ${clip(op.clip)}${op.start !== undefined ? ` to start at ${formatSeconds(op.start)}` : ''}${op.end !== undefined ? `${op.start !== undefined ? ' and' : ' to'} end at ${formatSeconds(op.end)}` : ''}`
      case 'splitClip':
        return `Split ${clip(op.clip)} at ${formatSeconds(op.at)}`
      case 'setSpeed':
        return `Play ${clip(op.clip)} at ${op.speed}×`
      case 'setFit':
        return `Fit ${clip(op.clip)} to the frame (${op.fit}${op.focusX !== undefined || op.focusY !== undefined ? `, focus ${Math.round((op.focusX ?? 0.5) * 100)}%, ${Math.round((op.focusY ?? 0.5) * 100)}%` : ''})`
      case 'applySpeedPreset':
        return `${SPEED_PRESETS.find((p) => p.name === op.preset)?.label ?? human(op.preset)} on ${clip(op.clip)}`
      case 'setClipProps': {
        const parts: string[] = []
        if (op.text !== undefined) parts.push(`text to “${op.text}”`)
        if (op.opacity !== undefined) parts.push(`opacity ${Math.round(op.opacity * 100)}%`)
        if (op.volume !== undefined) parts.push(`volume ${Math.round(op.volume * 100)}%`)
        if (op.scale !== undefined) parts.push(`scale ${Math.round(op.scale * 100)}%`)
        if (op.rotation !== undefined) parts.push(`rotation ${Math.round(op.rotation)}°`)
        if (op.x !== undefined || op.y !== undefined) parts.push('position')
        if (op.color !== undefined) parts.push(`colour ${op.color}`)
        if (op.anchorX !== undefined || op.anchorY !== undefined) parts.push(`pivot ${op.anchorX ?? 0.5}, ${op.anchorY ?? 0.5}`)
        if (op.under !== undefined) parts.push(`under ${clip(op.under)}`)
        return `Set ${clip(op.clip)} ${parts.join(', ')}`
      }
      case 'setStyle': {
        const parts: string[] = []
        if (op.fill !== undefined) parts.push(`fill ${op.fill}`)
        if (op.stroke !== undefined) parts.push(`stroke ${op.stroke}`)
        if (op.strokeWidth !== undefined) parts.push(`stroke width ${op.strokeWidth}`)
        if (op.fontId !== undefined) parts.push(`font ${human(op.fontId)}`)
        if (op.fontWeight !== undefined) parts.push(`weight ${op.fontWeight}`)
        if (op.fontSize !== undefined) parts.push(`size ${Math.round(op.fontSize)}`)
        if (op.cornerRadius !== undefined) parts.push(`corner radius ${Math.round(op.cornerRadius * 100)}%`)
        if (op.textAlign !== undefined) parts.push(`align ${op.textAlign}`)
        if (op.letterSpacing !== undefined) parts.push(`letter spacing ${op.letterSpacing}`)
        return `Style ${clip(op.clip)}: ${parts.join(', ')}`
      }
      case 'applyMotionPreset':
        return `Animate ${clip(op.clip)}: ${human(op.preset)}${op.syncTo === 'beats' ? ' on the beat' : ''}`
      case 'staggerPreset': {
        const shown = op.clips.slice(0, 3).map((c) => clip(c))
        const more = op.clips.length > 3 ? ` and ${op.clips.length - 3} more` : ''
        return `Stagger ${human(op.preset)} across ${shown.join(', ')}${more}${op.offsetFrames > 0 ? ` (${op.offsetFrames} frames apart${op.from && op.from !== 'start' ? `, from ${typeof op.from === 'number' ? `clip ${op.from + 1}` : op.from}` : ''}${op.grid ? `, ${op.grid}-column grid` : ''})` : ''}`
      }
      case 'setKeyframes':
        return `Keyframe ${clip(op.clip)} ${channelName(op.channel)} (${op.keys.length} key${op.keys.length === 1 ? '' : 's'})`
      case 'setExpression':
        return op.source
          ? `Drive ${clip(op.clip)} ${channelName(op.channel)} with an expression`
          : `Remove the ${channelName(op.channel)} expression from ${clip(op.clip)}`
      case 'addTransition':
        return `${getTransitionDefinition(op.kind)?.label ?? op.kind} from ${clip(op.from)}${op.to ? ` into ${clip(op.to)}` : ' into the next clip'}${op.duration ? ` (${dur(op.duration)})` : ''}`
      case 'removeTransition': {
        const all = project.transitions ?? []
        const t = op.transition ? all.find((x) => x.id === op.transition) : all.find((x) => x.fromClipId === op.from && (!op.to || x.toClipId === op.to))
        const fromId = t?.fromClipId ?? op.from
        const toId = t?.toClipId ?? op.to
        const what = t ? (getTransitionDefinition(t.kind)?.label ?? t.kind).toLowerCase() : 'transition'
        const where = fromId && toId ? ` between ${clip(fromId)} and ${clip(toId)}` : fromId ? ` leaving ${clip(fromId)}` : ''
        return `Remove the ${what}${where}`
      }
      case 'beatCuts': {
        const every = op.every ?? 1
        return `Cut ${clip(op.clip)} on ${every > 1 ? `every ${every} beats` : 'every beat'}`
      }
      case 'silenceFreeze':
        return `Freeze ${clip(op.clip)} during silences`
      case 'removeRanges': {
        const total = op.ranges.reduce((t, r) => t + Math.max(0, r.to - r.from), 0)
        const n = op.ranges.length
        return `Cut ${n} range${n === 1 ? '' : 's'} (${dur(total)}) out of ${clip(op.clip)}${op.ripple === false ? ' and leave the gaps' : ' and close the gaps'}`
      }
      case 'crossfadeCuts': {
        const where = op.clips && op.clips.length > 0 ? `in ${op.clips.length} clip${op.clips.length === 1 ? '' : 's'}` : op.track !== undefined ? `on ${trackName(op.track)}` : 'everywhere'
        return `Crossfade the cuts ${where} (${op.ms ?? 10} ms)`
      }
      case 'duckUnder': {
        const n = op.segments?.length ?? 0
        return `Lower ${clip(op.music)} by ${Math.abs(op.amountDb ?? -12)} dB under ${clip(op.voice)}${n > 0 ? ` · ${n} stretch${n === 1 ? '' : 'es'} of speech` : ''}`
      }
      case 'addSfx':
        return `Add sound effect “${assets?.get(op.asset)?.name ?? op.asset}” at ${formatSeconds(op.at)} · volume ${Math.round((op.volume ?? 0.6) * 100)}%${op.duration !== undefined ? ` · ${dur(op.duration)}` : ''}`
      case 'addEffect': {
        const def = EFFECT_REGISTRY.get(op.kind)
        const preset = def?.presets?.find((p) => p.id === op.preset)?.label
        return `Add ${preset ? `${preset} ` : ''}${def?.label.toLowerCase() ?? op.kind} to ${clip(op.clip)}`
      }
      case 'applyLook':
        return `Apply the ${EFFECT_BUNDLES.find((b) => b.id === op.look)?.label ?? op.look} look to ${clip(op.clip)}`
      case 'setEffectParam':
        return `Set ${human(op.effect)} ${human(op.param)} to ${String(op.value)} on ${clip(op.clip)}`
      case 'removeEffects':
        return `Remove the effects from ${clip(op.clip)}`
      case 'removeEffect': {
        const kind = effectKinds.get(`${op.clip}/${op.effect}`) ?? op.effect
        return `Remove the ${EFFECT_REGISTRY.get(kind)?.label.toLowerCase() ?? human(kind)} effect from ${clip(op.clip)}`
      }
      case 'setBlend':
        return `Blend ${clip(op.clip)} as ${human(op.blend)}`
      case 'setMask':
        return op.shape === 'none' ? `Remove the mask from ${clip(op.clip)}` : `Mask ${clip(op.clip)} with a ${op.shape === 'rect' ? 'rectangle' : 'ellipse'}`
      case 'addAdjustment':
        return `Grade everything from ${formatSeconds(op.at)} for ${dur(op.duration)}${op.look ? ` with ${EFFECT_BUNDLES.find((b) => b.id === op.look)?.label ?? op.look}` : ''}`
      case 'addMarker':
        return `Add marker${op.name ? ` “${op.name}”` : ''} at ${formatSeconds(op.at)}`
      case 'setMarker': {
        if (op.remove) return `Remove ${markerName(op.marker)}`
        const parts: string[] = []
        if (op.name !== undefined) parts.push(`rename it “${op.name}”`)
        if (op.at !== undefined) parts.push(`move it to ${formatSeconds(op.at)}`)
        if (op.color !== undefined) parts.push(`colour it ${op.color}`)
        return `On ${markerName(op.marker)}: ${parts.join(', ')}`
      }
      case 'setInOut':
        if (op.clear) return 'Clear the in/out range'
        if (op.inSec !== undefined && op.outSec !== undefined) return `Set the in/out range from ${formatSeconds(op.inSec)} to ${formatSeconds(op.outSec)}`
        return op.inSec !== undefined ? `Set the in point at ${formatSeconds(op.inSec)}` : `Set the out point at ${formatSeconds(op.outSec ?? 0)}`
      case 'linkClips':
      case 'unlinkClips': {
        const parts = op.clips.map((c) => clip(c))
        const listed = parts.length <= 2 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
        return op.op === 'linkClips' ? `Link ${listed} so they move together` : `Unlink ${listed}`
      }
      case 'renameClip':
        return `Rename ${clip(op.clip)} to “${op.name}”`
      case 'setTrack': {
        const who = trackName(op.track)
        if (op.remove) return `Remove the empty track ${who}`
        const parts: string[] = []
        if (op.name !== undefined) parts.push(`rename it “${op.name}”`)
        if (op.locked !== undefined) parts.push(op.locked ? 'lock it' : 'unlock it')
        if (op.hidden !== undefined) parts.push(op.hidden ? 'hide it' : 'show it')
        if (op.muted !== undefined) parts.push(op.muted ? 'mute it' : 'unmute it')
        return `Track ${who}: ${parts.join(', ')}`
      }
      case 'nest': {
        const parts = op.clips.map((c) => clip(c))
        const listed =
          parts.length <= 2 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
        return `Group ${listed} into one compound`
      }
      case 'unnest':
        return `Put ${clip(op.clip)} back on the timeline`
      case 'addComposition': {
        const n = op.props.length
        const b = op.bindings?.length ?? 0
        if (n === 0) return `Bind ${b} field${b === 1 ? '' : 's'}`
        return `Make ${n} prop${n === 1 ? '' : 's'} (${op.props.map((p) => p.name).join(', ')})${b ? ` and bind ${b} field${b === 1 ? '' : 's'}` : ''}`
      }
      case 'setProp':
        return `Set prop “${op.name}” to ${typeof op.value === 'string' ? `“${op.value.slice(0, 60)}”` : String(op.value)}`
      case 'setComponentField': {
        const shown = Array.isArray(op.value) ? op.value.join(', ') : typeof op.value === 'number' ? `${op.value}s` : `“${op.value.slice(0, 60)}”`
        const what = op.field === 'emphasis' ? 'emphasis words' : op.field
        return `Set ${clip(op.clip)} ${what} to ${shown || 'none'}`
      }
      case 'setComponentItems': {
        const labels = op.items.map((i) => i.text ?? i.sub ?? (i.value !== undefined ? String(i.value) : '·')).slice(0, 4)
        const more = op.items.length > 4 ? `, +${op.items.length - 4}` : ''
        return `Set ${clip(op.clip)} to ${op.items.length} item${op.items.length === 1 ? '' : 's'}: ${labels.join(', ')}${more}`
      }
      case 'regenerateElement':
        return `Regenerate ${clip(op.clip)}: “${op.brief.slice(0, 80)}${op.brief.length > 80 ? '…' : ''}”`
      case 'removeBackground':
        return `Remove the background from ${clip(op.clip)} (${op.land === 'sandwich' ? 'sandwich: cut copy above the original' : 'replace: the clip is cut'})`
      case 'insertSourceRange':
        return `Insert “${assets?.get(op.asset)?.name ?? op.asset}” ${formatSeconds(op.start)}–${formatSeconds(op.end)} at ${op.at !== undefined ? formatSeconds(op.at) : 'the end of the lane'}${op.speed && op.speed !== 1 ? ` · ${op.speed}× speed` : ''}${op.mute ? ' · muted' : ''}${op.overlay ? ' · overlay' : ''}`
      case 'addCaptions': {
        const range = op.from !== undefined || op.to !== undefined ? ` from ${formatSeconds(op.from ?? 0)}${op.to !== undefined ? ` to ${formatSeconds(op.to)}` : ''}` : ''
        const n = op.words?.length
        return `Caption ${clip(op.clip)}${range} from its transcript${n !== undefined ? ` · ${n} word${n === 1 ? '' : 's'}` : ''}${op.style && op.style !== 'static' ? ` · ${op.style}` : ''}${op.position && op.position !== 'bottom' ? ` · ${op.position}` : ''}`
      }
      case 'insertStock':
        return `Insert stock "${op.query}" ${op.duration.toFixed(1)}s at ${op.at !== undefined ? formatSeconds(op.at) : 'the end of the lane'}${op.kind === 'photo' ? ' · photo' : ''}`
      case 'addImage':
        if (op.under !== undefined) {
          return `Place image “${assets?.get(op.asset)?.name ?? op.asset}” behind ${clip(op.under)}${op.at !== undefined ? ` at ${formatSeconds(op.at)}` : ''}${op.duration !== undefined ? ` for ${dur(op.duration)}` : ' for its whole length'}`
        }
        return `Place image “${assets?.get(op.asset)?.name ?? op.asset}” at ${op.at !== undefined ? formatSeconds(op.at) : 'the end of the lane'} for ${dur(op.duration ?? IMAGE_DEFAULT_SECONDS)}${op.overlay ? ' · overlay' : ''}`
      case 'insertVector':
        return `Place ${op.asset !== undefined ? `“${assets?.get(op.asset)?.name ?? op.asset}”` : `an open-source icon for “${op.query ?? ''}”`} as editable vector shapes at ${op.at !== undefined ? formatSeconds(op.at) : 'the playhead'}`
      case 'insertScene': {
        const parts = Object.values(op.clip?.compound?.project.clips ?? {}).reduce((n, list) => n + list.length, 0)
        return `placed scene ${op.clip?.name ?? 'scene'} (${parts} part${parts === 1 ? '' : 's'})`
      }
      case 'generateMedia':
        return `Generate a ${op.media}: “${op.prompt.slice(0, 80)}${op.prompt.length > 80 ? '…' : ''}” at ${formatSeconds(op.at)}`
    }
  }
}
