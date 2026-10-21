/**
 * `data-motion` → native keys (MC-1b; plan section 4.3). A one-line language in
 * the engine's own vocabulary, so there is no CSS-animation semantics to parse:
 *
 *   in: pop-overshoot 0.4s @0.2;  x: 0.30 → 0.50 0.6s overshoot @1.0;
 *   opacity: hold 0.5s @2;  out: blur-out 0.3s @-0.3;  stagger: children 4f
 *
 * `parseMotion` is pure text. `motionPatch` lowers the clauses of one clip to
 * the same keys `setKeyframes` and `applyMotionPreset` write, through the very
 * functions they use (`keyPatch` from `ops/keyPatch.ts`, `applyMotionPreset` /
 * `staggerPresetPatches` from `elements/motionPresets.ts`).
 */

import type { AnyKeyframeChannel, Clip, ClipKeyframes, Keyframe, TextAnimationEasing, TextAnimatorChannel, TextAnimatorTween, TextAnimatorUnit } from '../../types'
import {
  authoredColor,
  channelValueKind,
  type BaselineContext,
} from '../../elements/keyframes'
import {
  applyMotionPreset,
  MOTION_PRESETS,
  presetAppliesTo,
  staggerPresetPatches,
  type MotionPresetName,
} from '../../elements/motionPresets'
import { BEZIER_PRESETS, findBezierPreset } from '../../elements/easingPresets'
import { SPRING_PRESETS, findSpringPreset } from '../../elements/springPresets'
import { resolveTemplateRamp } from '../../elements/textTemplates'
import { keyPatch } from '../../ops/keyPatch'
import { repeatKeysPatch } from '../../elements/keyRepeat'
import { isValidSteps } from '../../resolver/keyframes'
import { isScramblePreset, MAX_SCRAMBLE_CHARSET, SCRAMBLE_PRESETS } from '../../elements/scramble'
import type { KeyOp } from '../../ops/types'
import { TEXT_ANIMATION_EASINGS } from '../../resolver/textAnimation'
import { isValidBezier, normalizeBezier } from '../../resolver/bezier'
import { parseColor } from '../../utils/color'
import { staggerOffsets, STAGGER_FROM_NAMES, type StaggerFrom, type StaggerFromName } from '../../elements/stagger'
import { buildPathTable, motionPathIssue } from '../../resolver/motionPath'
import type { SceneViolation } from './types'

// ---------------------------------------------------------------------------
// Grammar
// ---------------------------------------------------------------------------

/**
 * MOT-6: a position relative to the previous clause of the element (`@<`, `@>0.2`) or to a named label
 * (`@intro+0.3`). `offset` is seconds. Mutually exclusive with `at` on a clause.
 */
export type MotionRef =
  | { kind: 'prev'; edge: 'start' | 'end'; offset: number }
  | { kind: 'label'; name: string; offset: number }

export type MotionClause =
  | { kind: 'preset'; end: 'in' | 'out'; preset: MotionPresetName; /** An ease for the arriving key (plan 4.5: `in: slide-in-up 0.4s overshoot`). */ ease?: string; /** seconds */ dur?: number; /** seconds, negative = from the scene end */ at?: number; ref?: MotionRef }
  | { kind: 'channel'; channel: string; from: string; to: string; dur: number; ease: string; at?: number; ref?: MotionRef; /** MOT-7: extra plays after the first (0..64) or `forever` (fills to the clip end). */ repeat?: number | 'forever'; /** MOT-7: every other play runs backwards. */ yoyo?: true; /** MOT-7: seconds of rest between plays. */ repeatDelay?: number; /** MOT-5: `chars=` / `seed=` tokens of a `scramble:` clause. */ scramble?: { chars?: string; seed?: number } }
  | { kind: 'hold'; channel: string; dur: number; at?: number; ref?: MotionRef }
  /** MOT-1: `path: (M 100 900 C 300 200 700 200 900 900) orient [offset 90deg]` makes the clip travel that path (stage px) as `progress` runs 0..1. */
  | { kind: 'path'; d: string; orient?: true; /** degrees */ offset?: number; ref?: undefined; at?: undefined }
  /** MOT-6: `label: intro @0.4` names a scene-time position other clauses can use. */
  | { kind: 'label'; name: string; at?: number; ref?: MotionRef }
  /** MOT-3: `split: word 2f [from center] [ease quad-out]` splits a text clip into units that start `frames` apart. */
  | { kind: 'split'; unit: TextAnimatorUnit; /** frames */ frames?: number; /** milliseconds */ ms?: number; from?: StaggerFromName; ease?: TextAnimationEasing; ref?: undefined; at?: undefined }
  /** MOT-3: `each: y: 0.6 → 0 0.5s back-out` tweens one channel of every unit; values are in the animator's own units (see `EACH_CHANNELS`). */
  | { kind: 'each'; channel: TextAnimatorChannel; from: number; to: number; dur: number; ease?: TextAnimationEasing; ref?: undefined; at?: undefined }
  | { kind: 'stagger'; /** frames */ frames?: number; /** milliseconds */ ms?: number; /** MOT-2: where the stagger starts. */ from?: StaggerFrom; ease?: TextAnimationEasing; /** Grid columns. */ grid?: number }

/** Clip types that draw a rotateX / rotateY tilt (see export/gpuExport.ts kindDrawsTilt). */
const TILT_CLIP_TYPES: ReadonlySet<string> = new Set(['video', 'image', 'sequence', 'compound'])

const SIMPLE_CHANNELS = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'rotateX', 'rotateY', 'opacity', 'cornerRadius', 'color', 'draw', 'draw.start', 'shape.fill', 'shape.stroke']
/**
 * MC-2d: CSS-flavoured names for the Tier B engine channels. The clause stores
 * the engine channel, so everything downstream (hold, keyPatch, violations)
 * sees `text.fontSize`, not `font-size`.
 */
const CHANNEL_ALIAS: Record<string, string> = {
  'font-size': 'text.fontSize',
  'letter-spacing': 'text.letterSpacing',
  'stroke-width': 'stroke.width',
  'anchor-x': 'anchor.x',
  'anchor-y': 'anchor.y',
  // MOT-1: progress along the clip's `path:`.
  progress: 'motion.progress',
  // MOT-5: scramble-text progress, 0 = noise, 1 = the real text.
  scramble: 'text.scramble',
}
const PX_CHANNELS: ReadonlyArray<string> = ['text.fontSize', 'text.letterSpacing', 'stroke.width']
const MASK_FIELDS = ['x', 'y', 'width', 'height', 'rotation', 'feather']
const CHANNEL_LIST = [...SIMPLE_CHANNELS, ...Object.keys(CHANNEL_ALIAS),...MASK_FIELDS.map((f) => `mask.${f}`), 'fx.<effect>.<param>']

const EASE_NAMES: string[] = [
  ...(TEXT_ANIMATION_EASINGS as ReadonlyArray<string>),
  ...BEZIER_PRESETS.map((b) => b.id),
  ...SPRING_PRESETS.map((s) => `spring:${s.id}`),
]

const PRESETS_IN = MOTION_PRESETS.filter((p) => p.end === 'in').map((p) => p.name as string)
const PRESETS_OUT = MOTION_PRESETS.filter((p) => p.end === 'out').map((p) => p.name as string)

function distance(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]
}

export function nearest(input: string, candidates: string[]): string {
  let best = candidates[0]
  let bestD = Infinity
  for (const c of candidates) {
    const d = distance(input.toLowerCase(), c.toLowerCase())
    if (d < bestD) {
      best = c
      bestD = d
    }
  }
  return best
}

const bad = (raw: string, message: string, substitute?: string): SceneViolation => ({
  element: 'data-motion',
  value: raw.trim(),
  message,
  ...(substitute ? { substitute } : {}),
})

function splitOutsideParens(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === sep && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

function tokens(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

/** MOT-7: the most extra plays one clause may ask for, and the most keys it may write. */
const MAX_REPEAT = 64
const MAX_REPEAT_KEYS = 130

/** MOT-3: the `each:` channel names and how their numbers read: x/y are font-size fractions, rotation degrees, blur px. */
const EACH_CHANNELS: Record<string, TextAnimatorChannel> = { opacity: 'opacity', x: 'dx', y: 'dy', scale: 'scale', rotation: 'rotation', blur: 'blur' }

const NUM = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)'

/** `0.4s`, `400ms`, or a bare number of seconds. */
function seconds(t: string | undefined): number | null {
  if (t === undefined) return null
  const m = new RegExp(`^(${NUM})(s|ms)?$`).exec(t)
  if (!m) return null
  const n = parseFloat(m[1])
  return m[2] === 'ms' ? n / 1000 : n
}

function validChannel(ch: string): boolean {
  if (SIMPLE_CHANNELS.includes(ch)) return true
  if (Object.prototype.hasOwnProperty.call(CHANNEL_ALIAS, ch)) return true
  if (/^mask\.(x|y|width|height|rotation|feather)$/.test(ch)) return true
  return /^fx\.[^.\s]+\.[^.\s]+$/.test(ch)
}

/** GSAP power names to the stored family (never stored themselves). */
const POWER_FAMILY: Record<string, string> = { power1: 'sine', power2: 'quad', power3: 'cubic', power4: 'quart', power5: 'quint' }
const EASE_DIR: Record<string, string> = { in: 'in', out: 'out', inout: 'in-out', 'in-out': 'in-out' }

/**
 * An ease token as the stored curve string: a GSAP alias (`power2.out`, `sine.inOut`)
 * becomes its stored name (`quad-out`, `sine-in-out`) and `steps(4)` becomes the
 * op curve `steps:4`. Anything else passes through for `validEase` to judge.
 */
function canonEase(tok: string): string {
  const steps = /^steps\(\s*(\d+)\s*\)$/.exec(tok)
  if (steps) return `steps:${steps[1]}`
  const m = /^([a-z]+\d?)\.(in|out|inout|in-out)$/i.exec(tok)
  if (!m) return tok
  const family = POWER_FAMILY[m[1].toLowerCase()] ?? m[1].toLowerCase()
  const dir = EASE_DIR[m[2].toLowerCase()]
  const name = `${family}-${dir}`
  return (TEXT_ANIMATION_EASINGS as ReadonlyArray<string>).includes(name) ? name : tok
}

/** MOT-9: the words people reach for instead of a stagger / split origin, so the error can name the right one. */
const ORIGIN_ALIASES: Record<string, StaggerFromName> = { middle: 'center', centre: 'center', mid: 'center', first: 'start', beginning: 'start', last: 'end', outside: 'edges', outer: 'edges', shuffle: 'random', shuffled: 'random' }
const originSubstitute = (v: string): string => ORIGIN_ALIASES[v.toLowerCase()] ?? nearest(v, [...STAGGER_FROM_NAMES])

function validEase(e: string): boolean {
  const st = /^steps:(\d+)$/.exec(e)
  if (st) return isValidSteps(Number(st[1]))
  if (EASE_NAMES.includes(e)) return true
  const m = /^cubic-bezier\(([^)]*)\)$/.exec(e)
  if (!m) return false
  const v = m[1].split(',').map((n) => parseFloat(n))
  return v.length === 4 && isValidBezier(v as [number, number, number, number])
}

/** The text after `@`: seconds, `<`/`>` with an optional offset, or a label name with an optional `+`/`-` offset. */
function parsePosition(s: string): { at: number } | { ref: MotionRef } | null {
  const abs = seconds(s)
  if (abs !== null) return { at: abs }
  const rel = /^([<>])(.*)$/.exec(s)
  if (rel) {
    const offset = rel[2] === '' ? 0 : seconds(rel[2])
    return offset === null ? null : { ref: { kind: 'prev', edge: rel[1] === '<' ? 'start' : 'end', offset } }
  }
  const lab = /^([A-Za-z][A-Za-z0-9_]*)([+-].*)?$/.exec(s)
  if (lab) {
    const offset = lab[2] === undefined ? 0 : seconds(lab[2])
    return offset === null ? null : { ref: { kind: 'label', name: lab[1], offset } }
  }
  return null
}

export function parseMotion(src: string): { clauses: MotionClause[]; errors: SceneViolation[] } {
  const clauses: MotionClause[] = []
  const errors: SceneViolation[] = []
  for (const raw of splitOutsideParens(src, ';')) {
    const text = raw.trim()
    if (text === '') continue
    const colon = text.indexOf(':')
    if (colon < 0) {
      errors.push(bad(text, 'a motion clause is "<channel>: …", "in: …", "out: …" or "stagger: …"'))
      continue
    }
    const head = text.slice(0, colon).trim()
    const body = text.slice(colon + 1).trim().replace(/\s*(→|->)\s*/g, ' → ')

    if (head === 'path') {
      const ptoks = tokens(body)
      const first = ptoks[0]
      if (first !== undefined && first.startsWith('#')) {
        errors.push(bad(text, 'path cannot point at an element yet; write the path data: "path: (M 100 900 C 300 200 700 200 900 900) orient"'))
        continue
      }
      if (first === undefined || !first.startsWith('(') || !first.endsWith(')') || first.slice(1, -1).trim() === '') {
        errors.push(bad(text, 'path needs (d): "path: (M 100 900 C 300 200 700 200 900 900) [orient] [offset <n>deg]" with d in stage px'))
        continue
      }
      const d = first.slice(1, -1).trim()
      if (buildPathTable(d) === null) {
        errors.push(bad(text, `path (${d.length > 40 ? `${d.slice(0, 40)}…` : d}) is not valid SVG path data`))
        continue
      }
      let orient = false
      let offset: number | undefined
      let pbad: SceneViolation | undefined
      for (let k = 1; k < ptoks.length && !pbad; k++) {
        const t = ptoks[k]
        if (t === 'orient') orient = true
        else if (t === 'offset') {
          const m = new RegExp(`^(${NUM})(deg)?$`).exec(ptoks[++k] ?? '')
          if (m) offset = parseFloat(m[1])
          else pbad = bad(text, 'offset is a number of degrees, e.g. "offset 90deg"')
        } else pbad = bad(text, `unknown path option "${t}"`, nearest(t, ['orient', 'offset']))
      }
      if (!pbad && offset !== undefined && !orient) pbad = bad(text, '"offset" turns the clip along the path, so it needs "orient"')
      if (pbad) {
        errors.push(pbad)
        continue
      }
      clauses.push({ kind: 'path', d, ...(orient ? { orient: true as const } : {}), ...(offset !== undefined ? { offset } : {}) })
      continue
    }

    if (head === 'split') {
      const m = /^(char|word|line)\s+(\d+(?:\.\d+)?)(f|ms)((?:\s+\S+)*)$/.exec(body)
      if (!m) {
        errors.push(bad(text, 'split is "split: char|word|line <n>f|<n>ms [from start|end|center|edges|random] [ease <name>]"', 'split: word 2f'))
        continue
      }
      const extra = m[4].trim() === '' ? [] : m[4].trim().split(/\s+/)
      let from: StaggerFromName | undefined
      let easeName: TextAnimationEasing | undefined
      let problem: SceneViolation | undefined
      for (let k = 0; k < extra.length && !problem; k += 2) {
        const key = extra[k]
        const val = extra[k + 1]
        if (val === undefined) problem = bad(text, `"${key}" needs a value`)
        else if (key === 'from') {
          if ((STAGGER_FROM_NAMES as ReadonlyArray<string>).includes(val)) from = val as StaggerFromName
          else problem = bad(text, `unknown split origin "${val}"`, originSubstitute(val))
        } else if (key === 'ease') {
          const canon = canonEase(val)
          if ((TEXT_ANIMATION_EASINGS as ReadonlyArray<string>).includes(canon)) easeName = canon as TextAnimationEasing
          else problem = bad(text, `unknown split ease "${val}"`, nearest(canon, EASE_NAMES))
        } else problem = bad(text, `unknown split option "${key}"`, nearest(key, ['from', 'ease']))
      }
      if (problem) {
        errors.push(problem)
        continue
      }
      clauses.push({
        kind: 'split',
        unit: m[1] as TextAnimatorUnit,
        ...(m[3] === 'f' ? { frames: parseFloat(m[2]) } : { ms: parseFloat(m[2]) }),
        ...(from !== undefined ? { from } : {}),
        ...(easeName !== undefined ? { ease: easeName } : {}),
      })
      continue
    }

    if (head === 'each') {
      const m = new RegExp(`^([a-z]+)\\s*:\\s*(${NUM})\\s*→\\s*(${NUM})\\s+(${NUM}(?:s|ms)?)(?:\\s+(\\S+))?$`).exec(body)
      const usage = 'each is "each: <opacity|x|y|scale|rotation|blur>: <from> → <to> <dur> [<ease>]", e.g. "each: y: 0.6 → 0 0.5s back-out"'
      if (!m) {
        errors.push(bad(text, usage))
        continue
      }
      const channel = EACH_CHANNELS[m[1]]
      if (!channel) {
        errors.push(bad(text, `unknown each channel "${m[1]}"`, nearest(m[1], Object.keys(EACH_CHANNELS))))
        continue
      }
      const dur = seconds(m[4])
      if (dur === null || dur <= 0) {
        errors.push(bad(text, 'each needs a duration like 0.4s'))
        continue
      }
      let easeName: TextAnimationEasing | undefined
      if (m[5] !== undefined) {
        const canon = canonEase(m[5])
        if ((TEXT_ANIMATION_EASINGS as ReadonlyArray<string>).includes(canon)) easeName = canon as TextAnimationEasing
        else {
          errors.push(bad(text, `unknown each ease "${m[5]}"`, nearest(canon, EASE_NAMES)))
          continue
        }
      }
      const a = parseFloat(m[2])
      const b = parseFloat(m[3])
      clauses.push({ kind: 'each', channel, from: channel === 'rotation' ? degToRad(a) : a, to: channel === 'rotation' ? degToRad(b) : b, dur, ...(easeName !== undefined ? { ease: easeName } : {}) })
      continue
    }

    if (head === 'stagger') {
      const m = /^children\s+(\d+(?:\.\d+)?)(f|ms)((?:\s+\S+)*)$/.exec(body)
      if (!m) {
        errors.push(bad(text, 'stagger is "stagger: children <n>f|<n>ms [from start|end|center|edges|random|<n>] [ease <name>] [grid <cols>]"'))
        continue
      }
      const extra = m[3].trim() === '' ? [] : m[3].trim().split(/\s+/)
      let from: StaggerFrom | undefined
      let easeName: TextAnimationEasing | undefined
      let grid: number | undefined
      let problem: SceneViolation | undefined
      for (let k = 0; k < extra.length && !problem; k += 2) {
        const key = extra[k]
        const val = extra[k + 1]
        if (val === undefined) {
          problem = bad(text, `"${key}" needs a value`)
        } else if (key === 'from') {
          if ((STAGGER_FROM_NAMES as ReadonlyArray<string>).includes(val)) from = val as StaggerFrom
          else if (/^\d+$/.test(val)) from = parseInt(val, 10)
          else problem = bad(text, `unknown stagger origin "${val}"`, originSubstitute(val))
        } else if (key === 'ease') {
          const canon = canonEase(val)
          if ((TEXT_ANIMATION_EASINGS as ReadonlyArray<string>).includes(canon)) easeName = canon as TextAnimationEasing
          else problem = bad(text, `unknown stagger ease "${val}"`, nearest(canon, EASE_NAMES))
        } else if (key === 'grid') {
          const g = /^\d+$/.test(val) ? parseInt(val, 10) : 0
          if (g >= 1 && g <= 64) grid = g
          else problem = bad(text, 'grid is a column count from 1 to 64')
        } else {
          problem = bad(text, `unknown stagger option "${key}"`, nearest(key, ['from', 'ease', 'grid']))
        }
      }
      if (problem) {
        errors.push(problem)
        continue
      }
      clauses.push({
        kind: 'stagger',
        ...(m[2] === 'f' ? { frames: parseFloat(m[1]) } : { ms: parseFloat(m[1]) }),
        ...(from !== undefined ? { from } : {}),
        ...(easeName !== undefined ? { ease: easeName } : {}),
        ...(grid !== undefined ? { grid } : {}),
      })
      continue
    }

    const toks = tokens(body)
    // MOT-5: `chars=<preset|literal>` and `seed=<n>` are read from anywhere in the clause, then removed, so `@at` stays last.
    let scrambleOpts: { chars?: string; seed?: number } | undefined
    let scrambleBad: SceneViolation | undefined
    for (let k = toks.length - 1; k >= 0; k--) {
      const om = /^(chars|seed)=(.*)$/.exec(toks[k])
      if (!om) continue
      toks.splice(k, 1)
      if (CHANNEL_ALIAS[head] !== 'text.scramble') {
        scrambleBad ??= bad(text, `"${om[1]}=" belongs to a "scramble:" clause`)
        continue
      }
      scrambleOpts ??= {}
      if (om[1] === 'seed') {
        if (/^-?\d{1,9}$/.test(om[2])) scrambleOpts.seed = parseInt(om[2], 10)
        else scrambleBad ??= bad(text, 'seed is a whole number, e.g. seed=7')
      } else {
        const v = om[2]
        const near = nearest(v, Object.keys(SCRAMBLE_PRESETS))
        if (isScramblePreset(v)) scrambleOpts.chars = v
        else if (v.length === 0) scrambleBad ??= bad(text, 'chars= needs a preset (upper, lower, alnum, symbols) or the characters to use', 'chars=upper')
        else if (Array.from(v).length > MAX_SCRAMBLE_CHARSET) scrambleBad ??= bad(text, `chars= is at most ${MAX_SCRAMBLE_CHARSET} characters`)
        else if (/^[a-z]{3,}$/.test(v) && distance(v, near) <= 2) scrambleBad ??= bad(text, `unknown charset preset "${v}"`, `chars=${near}`)
        else scrambleOpts.chars = v
      }
    }
    if (scrambleBad) {
      errors.push(scrambleBad)
      continue
    }
    // `@at` is always last and optional.
    let at: number | undefined
    let ref: MotionRef | undefined
    if (toks.length > 0 && toks[toks.length - 1].startsWith('@')) {
      const pos = parsePosition(toks.pop()!.slice(1))
      if (pos === null) {
        errors.push(bad(text, 'the "@" time must be seconds (@1.2, @-0.3), relative to the previous clause (@<, @>0.2) or a label (@intro+0.3)'))
        continue
      }
      if ('at' in pos) at = pos.at
      else ref = pos.ref
    }

    if (head === 'label') {
      if (toks.length !== 1 || !/^[A-Za-z][A-Za-z0-9_]*$/.test(toks[0])) {
        errors.push(bad(text, 'a label is "label: <name> [@<at>]"; a name starts with a letter and has letters, digits and "_"'))
        continue
      }
      clauses.push({ kind: 'label', name: toks[0], ...(at !== undefined ? { at } : {}), ...(ref ? { ref } : {}) })
      continue
    }

    if (head === 'in' || head === 'out') {
      const [name, durTok, ...extra] = toks
      if (extra.some((t) => t === 'repeat' || t === 'yoyo' || t === 'repeat-delay')) {
        errors.push(bad(text, 'repeat does not apply to a preset; repeat a "<channel>: <from> → <to>" clause'))
        continue
      }
      const easeTok = extra.length === 1 ? canonEase(extra[0]) : undefined
      const pool = head === 'in' ? PRESETS_IN : PRESETS_OUT
      if (!name) {
        errors.push(bad(text, `"${head}:" needs a preset name`, pool[0]))
        continue
      }
      if (!pool.includes(name)) {
        const other = (head === 'in' ? PRESETS_OUT : PRESETS_IN).includes(name)
        errors.push(bad(text, other ? `"${name}" is ${head === 'in' ? 'an exit' : 'an enter'} preset` : `unknown ${head === 'in' ? 'enter' : 'exit'} preset "${name}"`, other ? `${head === 'in' ? 'out' : 'in'}: ${name}` : nearest(name, pool)))
        continue
      }
      const dur = durTok === undefined ? undefined : seconds(durTok)
      if (dur === null || extra.length > 1 || (dur !== undefined && dur <= 0)) {
        errors.push(bad(text, `"${head}: ${name}" takes a duration like 0.4s, an optional ease and an optional @time`))
        continue
      }
      if (easeTok !== undefined && !validEase(easeTok)) {
        errors.push(bad(text, `unknown ease "${extra[0]}"`, nearest(easeTok, EASE_NAMES)))
        continue
      }
      clauses.push({ kind: 'preset', end: head, preset: name as MotionPresetName, ...(dur !== undefined ? { dur } : {}), ...(easeTok !== undefined ? { ease: easeTok } : {}), ...(at !== undefined ? { at } : {}), ...(ref ? { ref } : {}) })
      continue
    }

    // A channel clause.
    if (!validChannel(head)) {
      errors.push(bad(text, `unknown channel "${head}"`, nearest(head, CHANNEL_LIST)))
      continue
    }
    if (toks[0] === 'hold') {
      const repeatWord = toks.find((t) => t === 'repeat' || t === 'yoyo' || t === 'repeat-delay')
      if (repeatWord) {
        errors.push(bad(text, `"${repeatWord}" does not apply to a hold; repeat a "<from> → <to>" clause`))
        continue
      }
      const dur = seconds(toks[1])
      if (dur === null || dur <= 0 || toks.length !== 2) {
        errors.push(bad(text, 'a hold is "<channel>: hold <dur> [@<at>]"'))
        continue
      }
      clauses.push({ kind: 'hold', channel: CHANNEL_ALIAS[head] ?? head, dur, ...(at !== undefined ? { at } : {}), ...(ref ? { ref } : {}) })
      continue
    }
    const arrow = toks.indexOf('→')
    if (arrow !== 1 || toks.length < 4) {
      errors.push(bad(text, `"${head}: <from> → <to> <dur> [<ease>] [@<at>]" is the form of a channel clause (use "." for the static value)`))
      continue
    }
    const from = toks[0]
    const to = toks[2]
    const dur = seconds(toks[3])
    if (dur === null || dur <= 0) {
      errors.push(bad(text, 'the duration must be positive seconds, e.g. 0.6s'))
      continue
    }
    // MOT-7: after the duration come an optional ease and, in any order, `repeat <n|forever>`, `yoyo`, `repeat-delay <dur>`.
    let easeTok: string | undefined
    let repeat: number | 'forever' | undefined
    let yoyo = false
    let repeatDelay: number | undefined
    let tail: SceneViolation | undefined
    const rest = toks.slice(4)
    for (let k = 0; k < rest.length && !tail; k++) {
      const t = rest[k]
      if (t === 'yoyo') yoyo = true
      else if (t === 'repeat') {
        const v = rest[++k]
        if (v === 'forever') repeat = 'forever'
        else if (v !== undefined && /^\d+$/.test(v) && Number(v) <= MAX_REPEAT) repeat = Number(v)
        else if (v !== undefined && /^\d+$/.test(v)) tail = bad(text, `repeat is at most ${MAX_REPEAT}; use "repeat forever" to fill the clip`)
        else tail = bad(text, 'repeat is "repeat <whole number 0 to 64>" or "repeat forever"')
      } else if (t === 'repeat-delay') {
        const d = seconds(rest[++k])
        if (d === null || d < 0) tail = bad(text, 'repeat-delay is a duration like 0.2s')
        else repeatDelay = d
      } else if (easeTok === undefined) easeTok = t
      else tail = bad(text, 'only one ease is allowed per clause')
    }
    if (!tail && (yoyo || repeatDelay !== undefined) && repeat === undefined) tail = bad(text, `"${yoyo ? 'yoyo' : 'repeat-delay'}" needs a repeat count: add "repeat 3" or "repeat forever"`)
    if (tail) {
      errors.push(tail)
      continue
    }
    const ease = canonEase(easeTok ?? 'ease-out')
    if (!validEase(ease)) {
      errors.push(/^steps[(:]/.test(ease) ? bad(text, 'steps(n) takes a whole number of jumps from 1 to 64', 'steps(4)') : bad(text, `unknown ease "${easeTok}"`, nearest(ease, EASE_NAMES)))
      continue
    }
    clauses.push({
      kind: 'channel',
      channel: CHANNEL_ALIAS[head] ?? head,
      from,
      to,
      dur,
      ease,
      ...(at !== undefined ? { at } : {}),
      ...(ref ? { ref } : {}),
      ...(repeat !== undefined ? { repeat } : {}),
      ...(yoyo ? { yoyo: true as const } : {}),
      ...(repeatDelay !== undefined ? { repeatDelay } : {}),
      ...(scrambleOpts ? { scramble: scrambleOpts } : {}),
    })
  }
  return { clauses, errors }
}

// ---------------------------------------------------------------------------
// Lowering to keys
// ---------------------------------------------------------------------------

export interface MotionContext {
  fps: number
  /** Whole scene length in frames. */
  sceneDurationFrames: number
  /** Where the clip starts inside the scene (0 for a child that spans it). */
  clipStartFrameInScene: number
  stage: { width: number; height: number }
  baseline: BaselineContext
  /** Frames to push start-anchored clauses later by (the stagger offset of this clip). Default 0. */
  shiftFrames?: number
  /** MOT-6: scene-wide label positions in seconds (see `resolveLabels`). */
  labels?: ReadonlyMap<string, number>
}

type Rgba4 = [number, number, number, number]

function degToRad(d: number): number {
  return (d * Math.PI) / 180
}

/** A scalar written in the clause → the number the channel stores; null = unreadable. */
function scalarValue(channel: string, text: string, stage: { width: number; height: number }): number | null {
  const m = new RegExp(`^(${NUM})(px|deg|%)?$`).exec(text)
  if (!m) return null
  const n = parseFloat(m[1])
  const unit = m[2]
  if (channel === 'x' || channel === 'y') {
    if (unit === 'px') return n / (channel === 'x' ? stage.width : stage.height)
    return unit === undefined ? n : null
  }
  if (channel === 'rotation' || channel === 'mask.rotation') return unit === 'deg' || unit === undefined ? degToRad(n) : null
  // MOT-8: skew is an angle like rotation, stored in radians.
  if (channel === 'skewX' || channel === 'skewY') return unit === 'deg' || unit === undefined ? degToRad(n) : null
  // MOT-8 phase B: the 3D tilt is an angle too, in radians.
  if (channel === 'rotateX' || channel === 'rotateY') return unit === 'deg' || unit === undefined ? degToRad(n) : null
  // MC-2d: size, tracking and stroke width are stage px; a bare number is px too.
  if (PX_CHANNELS.includes(channel)) return unit === 'px' || unit === undefined ? n : null
  // anchor-x / anchor-y: a 0..1 fraction, or a percentage (next line).
  if (unit === '%') return n / 100
  return unit === undefined ? n : null
}

function colorVec(text: string): Rgba4 | null {
  const c = parseColor(text)
  return c ? ([...c] as Rgba4) : null
}

/** Set a cubic-bezier on the key at `frame` of `channel`, in a patch from `keyPatch`. */
function withBezier(patch: Partial<Clip>, channel: string, frame: number, bezier: [number, number, number, number]): Partial<Clip> {
  const track = patch.keyframes?.channels?.[channel as AnyKeyframeChannel]
  if (!patch.keyframes || !track) return patch
  const keys = track.keys.map((k) => (k.frame === frame ? { ...k, easingBezier: normalizeBezier(bezier) } : k))
  return {
    ...patch,
    keyframes: { ...patch.keyframes, channels: { ...patch.keyframes.channels, [channel]: { ...track, keys } } },
  }
}

/** Put `old`'s ease fields back on the key at `frame` (a hold rewrites the key it lands on). */
function restoreEase(patch: Partial<Clip>, channel: string, frame: number, old: Keyframe): Partial<Clip> {
  const track = patch.keyframes?.channels?.[channel as AnyKeyframeChannel]
  if (!patch.keyframes || !track) return patch
  const keys = track.keys.map((k) => {
    if (k.frame !== frame) return k
    const { easingBezier: _b, spring: _s, steps: _st, ...rest } = k
    return { ...rest, easing: old.easing, ...(old.steps !== undefined ? { steps: old.steps } : {}), ...(old.easingBezier ? { easingBezier: old.easingBezier } : {}), ...(old.spring ? { spring: old.spring } : {}) }
  })
  return { keyframes: { ...patch.keyframes, channels: { ...patch.keyframes.channels, [channel]: { ...track, keys } } } }
}

/** An easing no preset uses on its own, standing in for `ease` while a preset writes its keys. */
const PRESET_EASE_MARKER: TextAnimationEasing = 'bounce-out'

/** Replace the marker easing on keys `patch` added (ids not already on `before`) with the bezier or spring the clause asked for. */
function swapMarkedEase(patch: Partial<Clip>, before: Clip, ease: string): Partial<Clip> {
  if (!patch.keyframes) return patch
  const cubic = /^cubic-bezier(([^)]*))$/.exec(ease)
  const bezier = cubic ? (cubic[1].split(',').map((n) => parseFloat(n)) as [number, number, number, number]) : findBezierPreset(ease)?.bezier
  const spring = ease.startsWith('spring:') ? findSpringPreset(ease.slice('spring:'.length))?.spring : undefined
  const stepsN = ease.startsWith('steps:') ? Number(ease.slice('steps:'.length)) : NaN
  const steps = isValidSteps(stepsN) ? stepsN : undefined
  const known = new Set<string>()
  for (const track of Object.values(before.keyframes?.channels ?? {})) for (const k of track?.keys ?? []) known.add(k.id)
  const channels: ClipKeyframes['channels'] = {}
  for (const [ch, track] of Object.entries(patch.keyframes.channels) as Array<[AnyKeyframeChannel, NonNullable<ClipKeyframes['channels'][AnyKeyframeChannel]>]>) {
    channels[ch] = {
      ...track,
      keys: track.keys.map((k) => {
        if (known.has(k.id) || k.easing !== PRESET_EASE_MARKER) return k
        const { easing: _marker, ...rest } = k
        return {
          ...rest,
          easing: 'linear' as const,
          ...(steps !== undefined ? { steps } : {}),
          ...(spring ? { spring: { ...spring } } : bezier ? { easingBezier: normalizeBezier(bezier as [number, number, number, number]) } : {}),
        }
      }),
    }
  }
  return { ...patch, keyframes: { ...patch.keyframes, channels } }
}

// ---------------------------------------------------------------------------
// Timeline positions (MOT-6)
// ---------------------------------------------------------------------------

export interface TimeEnv {
  fps: number
  sceneDurationFrames: number
  clipStartFrameInScene: number
  clipDurationFrames: number
  shiftFrames: number
  labels?: ReadonlyMap<string, number>
}

/**
 * Where one clause lands, in clip-local frames. `labelSec` is set on a `label` clause (scene seconds).
 * `error` skips the clause; `blockedOn` names the label it waits for, so `resolveLabels` can tell a cycle from an unknown name.
 */
export type ClauseTime =
  | { start: number; end: number; labelSec?: number; warn?: SceneViolation }
  | { error: SceneViolation; blockedOn?: string }
  | null

/** A preset's default ramp when the clause gives no duration: a quarter of the clip, capped (the engine's own rule). */
const DEFAULT_RAMP_FRACTION = 0.25

/**
 * The start and end frame of every clause in source order (null for a stagger). `@1.2` / `@-0.3` keep their
 * meaning exactly; `@<` / `@>` read the previous non-stagger, non-label, non-path clause; `@name` reads `env.labels`.
 * Shared by `motionPatch` and the label pre-pass so both agree on every frame.
 */
export function clauseTimes(clauses: MotionClause[], env: TimeEnv): ClauseTime[] {
  const f = (sec: number): number => Math.round(sec * env.fps)
  const sceneLast = Math.max(0, env.sceneDurationFrames - 1)
  const clipLast = Math.max(0, env.clipDurationFrames - 1)
  const shift = Math.max(0, Math.round(env.shiftFrames))
  const local = (sceneFrame: number): number => Math.min(clipLast, Math.max(0, sceneFrame - env.clipStartFrameInScene))
  type Prev = { start: number; end: number } | null | { poisoned: string | undefined }
  let prev: Prev = null
  const out: ClauseTime[] = []

  for (const c of clauses) {
    if (c.kind === 'stagger' || c.kind === 'path' || c.kind === 'split' || c.kind === 'each') {
      out.push(null)
      continue
    }
    let sceneFrame: number
    let labelSec: number
    let warn: SceneViolation | undefined
    if (c.ref?.kind === 'prev') {
      if (prev && 'poisoned' in prev) {
        out.push({ error: bad(`@${c.ref.edge === 'start' ? '<' : '>'}`, 'follows a clause whose label could not be found, so it has nothing to be relative to'), blockedOn: prev.poisoned })
        continue
      }
      const base = prev ? (c.ref.edge === 'start' ? prev.start : prev.end) + env.clipStartFrameInScene : shift
      sceneFrame = base + f(c.ref.offset)
      labelSec = sceneFrame / env.fps
    } else if (c.ref?.kind === 'label') {
      const sec = env.labels?.get(c.ref.name)
      if (sec === undefined) {
        const known = [...(env.labels?.keys() ?? [])]
        out.push({
          error: bad(`@${c.ref.name}`, `unknown label "${c.ref.name}"`, known.length > 0 ? nearest(c.ref.name, known) : undefined),
          blockedOn: c.ref.name,
        })
        prev = { poisoned: c.ref.name }
        continue
      }
      const total = sec + c.ref.offset
      if (total < 0) warn = bad(`@${c.ref.name}`, `"@${c.ref.name}" resolves before the scene starts (${total.toFixed(2)}s); clamped to 0`)
      sceneFrame = f(Math.max(0, total))
      labelSec = Math.max(0, total)
    } else if (c.at !== undefined) {
      sceneFrame = c.at < 0 ? sceneLast + f(c.at) : f(c.at) + shift
      labelSec = c.at < 0 ? sceneLast / env.fps + c.at : c.at
    } else {
      sceneFrame = shift
      labelSec = 0
    }

    if (c.kind === 'label') {
      if (labelSec < 0 && !warn) warn = bad(`label: ${c.name}`, `label "${c.name}" resolves before the scene starts; clamped to 0`)
      const sec = Math.max(0, labelSec)
      const at0 = local(f(sec))
      out.push({ start: at0, end: at0, labelSec: sec, ...(warn ? { warn } : {}) })
      continue
    }

    if (c.kind === 'preset') {
      const ramp = c.dur === undefined ? Math.min(clipLast, resolveTemplateRamp(DEFAULT_RAMP_FRACTION, env.clipDurationFrames)) : Math.max(1, f(c.dur))
      const placed = c.at !== undefined || c.ref !== undefined
      let start: number
      let end: number
      if (c.end === 'in') {
        start = local(sceneFrame)
        end = Math.min(clipLast, start + ramp)
      } else if (!placed) {
        end = clipLast
        start = Math.max(0, clipLast - Math.min(clipLast, ramp))
      } else {
        start = local(sceneFrame)
        end = c.dur === undefined ? clipLast : Math.min(clipLast, start + Math.min(clipLast, ramp))
      }
      prev = { start, end }
      out.push({ start, end, ...(warn ? { warn } : {}) })
      continue
    }
    const start = local(sceneFrame)
    let end = Math.min(clipLast, start + Math.max(1, f(c.dur)))
    // MOT-7: a repeating clause ends where its last play ends, so `@>` follows the whole run.
    if (c.kind === 'channel' && c.repeat !== undefined && c.repeat !== 0) {
      const len = Math.max(1, f(c.dur))
      const gap = Math.max(0, f(c.repeatDelay ?? 0))
      const period = len + (c.yoyo ? gap : Math.max(gap, 1))
      end = c.repeat === 'forever' ? clipLast : Math.min(clipLast, start + len + c.repeat * period)
    }
    prev = { start, end }
    out.push({ start, end, ...(warn ? { warn } : {}) })
  }
  return out
}

/**
 * The scene-wide label table. `nodes` are every `data-motion` in the scene with the stagger shift its element gets.
 * Labels may be used before they are declared, so this iterates until stable (at most one pass per label). The first
 * declaration of a name wins; a label that cannot be placed because of a cycle is reported and set to 0.
 */
export function resolveLabels(
  nodes: Array<{ element: string; clauses: MotionClause[]; shiftFrames: number }>,
  env: { fps: number; sceneDurationFrames: number },
): { labels: Map<string, number>; violations: SceneViolation[] } {
  const violations: SceneViolation[] = []
  const first = new Set<MotionClause>()
  const names = new Set<string>()
  for (const n of nodes) {
    for (const c of n.clauses) {
      if (c.kind !== 'label') continue
      if (names.has(c.name)) violations.push({ ...bad(`label: ${c.name}`, `label "${c.name}" is declared twice; the first one wins`), element: n.element })
      else {
        names.add(c.name)
        first.add(c)
      }
    }
  }
  const labels = new Map<string, number>()
  if (names.size === 0) return { labels, violations }
  const timesOf = (n: (typeof nodes)[number]): ClauseTime[] =>
    clauseTimes(n.clauses, { fps: env.fps, sceneDurationFrames: env.sceneDurationFrames, clipStartFrameInScene: 0, clipDurationFrames: env.sceneDurationFrames, shiftFrames: n.shiftFrames, labels })
  for (let pass = 0; pass <= names.size; pass++) {
    let changed = false
    for (const n of nodes) {
      const times = timesOf(n)
      n.clauses.forEach((c, i) => {
        const t = times[i]
        if (c.kind === 'label' && first.has(c) && t && 'labelSec' in t && t.labelSec !== undefined && !labels.has(c.name)) {
          labels.set(c.name, t.labelSec)
          changed = true
        }
      })
    }
    if (!changed) break
  }
  for (const n of nodes) {
    const times = timesOf(n)
    n.clauses.forEach((c, i) => {
      if (c.kind !== 'label' || !first.has(c) || labels.has(c.name)) return
      const t = times[i]
      const blocked = t && 'error' in t ? t.blockedOn : undefined
      // Waiting on a name nobody declares is the unknown-label error `motionPatch` reports; anything else is a cycle.
      if (blocked === undefined || names.has(blocked)) {
        violations.push({ ...bad(`label: ${c.name}`, `label "${c.name}" cannot be placed: it depends on itself through ${blocked ? `"${blocked}"` : 'another label'}`), element: n.element })
      }
    })
  }
  for (const name of names) if (!labels.has(name)) labels.set(name, 0)
  return { labels, violations }
}

export function motionPatch(
  clip: Clip,
  clauses: MotionClause[],
  ctx: MotionContext,
): { patch: Partial<Clip>; violations: SceneViolation[] } {
  const violations: SceneViolation[] = []
  const f = (sec: number): number => Math.round(sec * ctx.fps)
  const clipLast = Math.max(0, clip.durationFrames - 1)
  // Clip-local start of each clause. `@-x` counts back from the scene's last visible frame and never takes the stagger.
  const times = clauseTimes(clauses, {
    fps: ctx.fps,
    sceneDurationFrames: ctx.sceneDurationFrames,
    clipStartFrameInScene: ctx.clipStartFrameInScene,
    clipDurationFrames: clip.durationFrames,
    shiftFrames: ctx.shiftFrames ?? 0,
    ...(ctx.labels ? { labels: ctx.labels } : {}),
  })

  let working: Clip = clip
  let patch: Partial<Clip> = {}
  const merge = (p: Partial<Clip>): void => {
    working = { ...working, ...p }
    patch = { ...patch, ...p }
  }
  /** The last value each channel was driven to, so a following `hold` knows what it holds. */
  const lastTo = new Map<string, number | Rgba4>()

  for (const [ci, c] of clauses.entries()) {
    if (c.kind === 'stagger' || c.kind === 'split' || c.kind === 'each') continue
    if (c.kind === 'path') {
      const issue = motionPathIssue(c.d)
      if (issue) violations.push({ element: 'data-motion', value: `path: (${c.d.length > 40 ? `${c.d.slice(0, 40)}…` : c.d})`, message: issue })
      merge({ motionPath: { d: c.d, ...(c.orient ? { orient: true } : {}), ...(c.offset !== undefined ? { offsetRotation: c.offset } : {}) } })
      continue
    }
    const time = times[ci]
    if (!time) continue
    if ('error' in time) {
      violations.push(time.error)
      continue
    }
    if (time.warn) violations.push(time.warn)
    if (c.kind === 'label') continue
    const placed = c.at !== undefined || c.ref !== undefined

    if (c.kind === 'preset') {
      const name = c.preset
      if (!presetAppliesTo(name, working.type)) {
        violations.push({ element: 'data-motion', value: `${c.end}: ${name}`, message: `"${name}" does not apply to a ${working.type} clip` })
        continue
      }
      const ramp = c.dur === undefined ? undefined : Math.max(1, f(c.dur))
      const named = c.ease !== undefined && (TEXT_ANIMATION_EASINGS as ReadonlyArray<string>).includes(c.ease)
      // A bezier / spring / cubic ease has no slot in a preset's params: run it with a marker easing, then swap the marker keys.
      const marked = c.ease !== undefined && !named
      const params: { rampFrames?: number; easing?: TextAnimationEasing } = {
        ...(ramp !== undefined ? { rampFrames: ramp } : {}),
        ...(named ? { easing: c.ease as TextAnimationEasing } : marked ? { easing: PRESET_EASE_MARKER } : {}),
      }
      let p: Partial<Clip>
      if (c.end === 'in') {
        // `staggerPresetPatches` is the exported way to start a preset N frames late: the clip at index 1 is shifted by one offset.
        const start = time.start
        p = start === 0 ? applyMotionPreset(working, name, params, ctx.baseline) : staggerPresetPatches([working, working], name, params, start, ctx.baseline)[1].patch
      } else {
        // An exit ends on the clip's last frame. For one that should end earlier, run the same preset on a copy that ends there.
        const naturalStart = placed ? time.start : undefined
        const span = ramp === undefined ? undefined : Math.min(clipLast, ramp)
        const end = naturalStart === undefined || span === undefined ? clipLast : Math.min(clipLast, naturalStart + span)
        p =
          end === clipLast
            ? applyMotionPreset(working, name, params, ctx.baseline)
            : applyMotionPreset({ ...working, durationFrames: end + 1 }, name, params, ctx.baseline)
      }
      if (Object.keys(p).length === 0) {
        violations.push({ element: 'data-motion', value: `${c.end}: ${name}`, message: `"${name}" wrote no keys on this clip` })
        continue
      }
      merge(marked ? swapMarkedEase(p, working, c.ease as string) : p)
      continue
    }

    const channel = c.channel as AnyKeyframeChannel
    // MOT-5: scramble animates the glyphs of a plain text element; say so rather than a generic key refusal.
    if (c.channel === 'text.scramble') {
      if (working.type !== 'text') {
        violations.push({ element: 'data-motion', value: `scramble: ${c.kind === 'channel' ? `${c.from} → ${c.to}` : 'hold'}`, message: `"scramble:" animates the glyphs of a text element; this is a ${working.type} clip` })
        continue
      }
      if (working.words?.length && working.captionMode && working.captionMode !== 'static') {
        violations.push({ element: 'data-motion', value: 'scramble', message: '"scramble:" does not apply to a caption clip' })
        continue
      }
      if (c.kind === 'channel') {
        merge({ textScramble: { ...working.textScramble, charset: c.scramble?.chars ?? working.textScramble?.charset ?? 'upper', ...(c.scramble?.seed !== undefined ? { seed: c.scramble.seed } : {}) } })
      } else if (!working.textScramble) merge({ textScramble: { charset: 'upper' } })
    }
    // MOT-8 phase B: only clips placed as one textured quad can be drawn in perspective. Text, shape
    // and freehand paint to a 2D canvas, which cannot show a projective tilt the same in preview and
    // export, so they are refused here rather than drawn flat without a word.
    if ((c.channel === 'rotateX' || c.channel === 'rotateY') && !TILT_CLIP_TYPES.has(working.type)) {
      violations.push({ element: 'data-motion', value: c.channel, message: `${c.channel} tilts an image, video, sequence or compound clip in 3D; a ${working.type} clip cannot (animate scale, rotation or skewX / skewY instead)` })
      continue
    }
    const kind = channelValueKind(working, channel)
    const start = time.start

    if (c.kind === 'hold') {
      const prior = lastTo.get(c.channel)
      const end = Math.min(clipLast, start + Math.max(1, f(c.dur)))
      const keys: Array<{ frame: number; op: KeyOp }> = []
      if (kind === 'color') {
        const vec = Array.isArray(prior) ? prior : colorVec(authoredColor(working, channel) ?? '')
        if (!vec) {
          violations.push({ element: 'data-motion', value: `${c.channel}: hold`, message: `cannot read the colour of ${c.channel}` })
          continue
        }
        keys.push({ frame: start, op: { at: 0, value: 0, vec, hold: true } }, { frame: end, op: { at: 0, value: 0, vec } })
      } else {
        const value = typeof prior === 'number' ? prior : NaN // NaN → the writer reads the current authored value
        keys.push({ frame: start, op: { at: 0, value, hold: true } }, { frame: end, op: { at: 0, value } })
      }
      // The key a hold lands on keeps the ease it was reached with.
      const old = (working.keyframes?.channels?.[channel]?.keys ?? []).find((k) => k.frame === start)
      if (!writeKeys(keys, c.channel)) continue
      if (old) merge(restoreEase(patch, c.channel, start, old))
      continue
    }

    // from → to
    const key = (text: string): KeyOp | null => {
      if (kind === 'color') {
        if (text === '.') return { at: 0, value: 0, vec: colorVec(authoredColor(working, channel) ?? '') ?? undefined }
        const vec = colorVec(text)
        return vec ? { at: 0, value: 0, vec } : null
      }
      if (text === '.') return { at: 0, value: NaN }
      const v = scalarValue(c.channel, text, ctx.stage)
      return v === null ? null : { at: 0, value: v }
    }
    const a = key(c.from)
    const b = key(c.to)
    if (!a || !b || (kind === 'color' && (!a.vec || !b.vec))) {
      violations.push({
        element: 'data-motion',
        value: `${c.channel}: ${c.from} → ${c.to}`,
        message: `cannot read "${!a ? c.from : c.to}" as a ${kind === 'color' ? 'colour' : c.channel === 'rotation' || c.channel === 'mask.rotation' || c.channel === 'skewX' || c.channel === 'skewY' || c.channel === 'rotateX' || c.channel === 'rotateY' ? 'number of degrees' : 'number'} for ${c.channel}`,
        ...(c.channel === 'x' || c.channel === 'y' ? { substitute: 'a stage fraction like 0.5, or a px value like 120px' } : {}),
      })
      continue
    }
    const end = Math.min(clipLast, start + Math.max(1, f(c.dur)))
    const cubic = /^cubic-bezier\(([^)]*)\)$/.exec(c.ease)
    if (!cubic) b.curve = c.ease
    const written = writeKeys([{ frame: start, op: a }, { frame: end, op: b, bezier: cubic ? (cubic[1].split(',').map((n) => parseFloat(n)) as [number, number, number, number]) : undefined }], c.channel)
    if (written) lastTo.set(c.channel, b.vec ? (b.vec as Rgba4) : b.value)
    if (written && c.repeat !== undefined && c.repeat !== 0) {
      const r = repeatKeysPatch(working, channel, {
        from: start,
        to: end,
        count: c.repeat === 'forever' ? Infinity : c.repeat,
        yoyo: c.yoyo === true,
        gapFrames: f(c.repeatDelay ?? 0),
        maxKeys: MAX_REPEAT_KEYS - 2,
      })
      const label = `${c.channel}: ${c.from} → ${c.to} repeat ${c.repeat}`
      if (r.added === 0) violations.push({ element: 'data-motion', value: label, message: 'repeat wrote no keys: the clip ends before a second play fits' })
      else {
        merge(r.patch)
        // A yoyo with an odd number of plays back ends on the start value.
        if (c.yoyo && r.cycles % 2 === 1) {
          const first = working.keyframes?.channels?.[channel]?.keys.find((k) => k.frame === start)
          if (first) lastTo.set(c.channel, first.vec ? ([...first.vec] as Rgba4) : first.value)
        }
        if (r.capped) violations.push({ element: 'data-motion', value: label, message: `repeat capped at ${MAX_REPEAT_KEYS} keys per clause after ${r.cycles} cycles` })
        else if (r.cut) violations.push({ element: 'data-motion', value: label, message: `repeat cut at the clip end after ${r.cycles} cycles` })
      }
    }
  }

  // MOT-3: `split:` and `each:` write ONE textAnimator on the clip, not channel keys. Ordinary clauses above still key the clip.
  const split = clauses.find((x): x is Extract<MotionClause, { kind: 'split' }> => x.kind === 'split')
  const eaches = clauses.filter((x): x is Extract<MotionClause, { kind: 'each' }> => x.kind === 'each')
  if (split || eaches.length > 0) {
    const label = split ? `split: ${split.unit}` : `each: ${eaches[0]!.channel}`
    if (clip.type !== 'text') {
      violations.push({ element: 'data-motion', value: label, message: `"split:" and "each:" animate the units of a text element; this is a ${clip.type} clip` })
    } else if (eaches.length === 0) {
      violations.push({ element: 'data-motion', value: label, message: '"split:" needs at least one "each: <channel>: <from> → <to> <dur>" clause to say what the units do' })
    } else {
      const tween: TextAnimatorTween = {}
      for (const e of eaches) tween[e.channel] = [e.from, e.to]
      const easeName = eaches.find((e) => e.ease)?.ease
      if (new Set(eaches.map((e) => e.ease ?? '')).size > 1) {
        violations.push({ element: 'data-motion', value: label, message: `one ease drives all "each:" channels; using "${easeName}" for every one` })
      }
      const staggerEach = split ? (split.frames !== undefined ? Math.round(split.frames) : Math.round(((split.ms ?? 0) / 1000) * ctx.fps)) : 0
      merge({
        textAnimator: {
          unit: split?.unit ?? 'word',
          preset: 'fade',
          staggerFrames: staggerEach,
          durationFrames: Math.max(1, ...eaches.map((e) => f(e.dur))),
          ...(split?.from && split.from !== 'start' ? { from: split.from } : {}),
          ...(split?.ease ? { staggerEase: split.ease } : {}),
          ...(easeName ? { ease: easeName } : {}),
          tween,
        },
      })
    }
  }

  /** Write a clause's keys; the first refusal skips the whole clause (nothing half-keyed). */
  function writeKeys(keys: Array<{ frame: number; op: KeyOp; bezier?: [number, number, number, number] }>, channel: string): boolean {
    let cur = working
    let acc: Partial<Clip> = {}
    for (const k of keys) {
      let kp = keyPatch(cur, channel, k.frame, k.op, ctx.baseline)
      if (Object.keys(kp).length === 0) {
        violations.push({ element: 'data-motion', value: channel, message: `"${clip.name}" cannot take a ${channel} key` })
        return false
      }
      if (k.bezier) kp = withBezier(kp, channel, k.frame, k.bezier)
      acc = { ...acc, ...kp }
      cur = { ...cur, ...kp }
    }
    merge(acc)
    return true
  }

  return { patch, violations }
}

/** The stagger a node declares for its children, in frames; 0 when it declares none. */
export function staggerFrames(clauses: MotionClause[], fps: number): number {
  for (const c of clauses) {
    if (c.kind !== 'stagger') continue
    return c.frames !== undefined ? Math.round(c.frames) : Math.round(((c.ms ?? 0) / 1000) * fps)
  }
  return 0
}

/**
 * MOT-2: the frame offset of each of a node's `count` children; null when it declares no stagger. Same `each`
 * as `staggerFrames`, so a plain `children 4f` is exactly `i * 4`.
 */
export function staggerSpec(clauses: MotionClause[], fps: number, count: number): number[] | null {
  const c = clauses.find((x): x is Extract<MotionClause, { kind: 'stagger' }> => x.kind === 'stagger')
  if (!c) return null
  return staggerOffsets(count, {
    each: staggerFrames(clauses, fps),
    ...(c.from !== undefined ? { from: c.from } : {}),
    ...(c.ease !== undefined ? { ease: c.ease } : {}),
    ...(c.grid !== undefined ? { grid: { cols: c.grid } } : {}),
  })
}
