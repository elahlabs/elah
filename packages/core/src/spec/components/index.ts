/**
 * expandComponents — lowers an `AuthoredSpec` to a `VideoSpec` (AV-8).
 *
 * The walk is generic and finished; the library itself lives in `./library.ts`
 * and is what AV-8 fills in. See `./types.ts` for why this layer exists.
 *
 * Like the compiler, this never throws: an unknown component, a builder that
 * throws, or an id collision each become an issue, and the rest of the piece
 * still expands. A generated video missing one component is a better outcome
 * than no video.
 */

import type { ClipComponentInstance } from '../../types'
import type { SpecElement, SpecIssue, VideoSpec } from '../types'
import { COMPONENT_DEFS } from './library'
import { expandSystem, type ExpandSystemEnv } from '../systems'
import type { SpecSystem } from '../systems/types'
import { vectorPlaceholder } from '../vectorLowering'
import {
  AMBIENT_KINDS,
  BEAT_TRANSITIONS,
  COMPONENT_NAMES,
  DEFAULT_MOTION_STYLE,
  MOTION_ENERGIES,
  type AuthoredElement,
  type AuthoredSpec,
  type ComponentContext,
  type ComponentDef,
  type ComponentName,
  type ExpandResult,
  type MotionEnergy,
  type MotionStyle,
  type SpecComponent,
  type SpecVector,
} from './types'

export * from './types'

export const COMPONENT_REGISTRY: ReadonlyMap<ComponentName, ComponentDef> = new Map(
  COMPONENT_DEFS.map((d) => [d.name, d]),
)

/** Energy multiplier on durations: calm breathes, bold snaps. */
export const ENERGY_TIME_SCALE: Readonly<Record<MotionEnergy, number>> = {
  calm: 1.3,
  standard: 1,
  bold: 0.75,
}

const DEFAULT_COLORS = {
  bg: '#f7f7f5',
  ink: '#111111',
  muted: '#8a8a8a',
  accent: '#22c55e',
  accentSoft: '#bbf7d0',
  surface: '#ffffff',
} as const

const DEFAULT_FONTS = {
  sans: 'inter',
  serif: 'playfair-display',
  display: 'bebas-neue',
  mono: 'roboto-mono',
  hand: 'caveat',
} as const

const isOneOf = <T extends string>(list: ReadonlyArray<T>, v: unknown): v is T =>
  typeof v === 'string' && (list as ReadonlyArray<string>).includes(v)

/** Fill a partial style from the defaults, reporting any value that is not a known name. */
export function resolveMotionStyle(partial: Partial<MotionStyle> | undefined, issues: SpecIssue[] = []): MotionStyle {
  const style: MotionStyle = { ...DEFAULT_MOTION_STYLE }
  if (!partial) return style
  const take = <K extends keyof MotionStyle>(key: K, list: ReadonlyArray<string>) => {
    const v = partial[key]
    if (v === undefined || v === null) return
    if (isOneOf(list, v)) (style as unknown as Record<string, unknown>)[key] = v
    else issues.push({ severity: 'error', path: `motion.${key}`, code: 'unknown-style', message: `unknown ${key} "${String(v)}"` })
  }
  take('energy', MOTION_ENERGIES)
  take('ambient', AMBIENT_KINDS)
  take('transition', BEAT_TRANSITIONS)
  if (typeof partial.camera === 'boolean') style.camera = partial.camera
  return style
}

/** A small, fast, seeded PRNG (mulberry32). Deterministic per seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** A deep, JSON-safe copy: drops `undefined` members and anything JSON cannot hold. */
function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export interface ExpandOptions {
  seed?: number
}

export function expandComponents(authored: AuthoredSpec, opts: ExpandOptions = {}): ExpandResult {
  const issues: SpecIssue[] = []
  const style = resolveMotionStyle(authored.motion, issues)
  const colorNames = new Set((authored.design?.colors ?? []).map((c) => c.name))
  const fontRoles = new Set((authored.design?.fonts ?? []).map((f) => f.role))
  let seenIds = new Set<string>()
  const baseSeed = opts.seed ?? 1
  const componentInstances: Record<string, ClipComponentInstance> = {}
  const designRecord = ((): ClipComponentInstance['design'] => {
    const colors = authored.design?.colors
    const fonts = authored.design?.fonts
    if (!colors?.length && !fonts?.length) return undefined
    return jsonSafe({ ...(colors?.length ? { colors } : {}), ...(fonts?.length ? { fonts } : {}) })
  })()

  const claimId = (id: string, path: string): string => {
    if (!seenIds.has(id)) {
      seenIds.add(id)
      return id
    }
    let n = 2
    while (seenIds.has(`${id}-${n}`)) n++
    const next = `${id}-${n}`
    seenIds.add(next)
    issues.push({ severity: 'warn', path, code: 'duplicate-id', message: `id "${id}" is used more than once; renamed to "${next}"` })
    return next
  }

  const expandOne = (c: SpecComponent, path: string): SpecElement | null => {
    const def = COMPONENT_REGISTRY.get(c.component as ComponentName)
    if (!def) {
      const known = isOneOf(COMPONENT_NAMES, c.component)
      issues.push({
        severity: 'error',
        path: `${path}.component`,
        code: known ? 'component-unavailable' : 'unknown-component',
        message: known
          ? `component "${c.component}" is named but not built yet`
          : `unknown component "${String(c.component)}"`,
      })
      return null
    }

    let duration = Number.isFinite(c.duration) ? c.duration : def.duration.default
    if (duration < def.duration.min || duration > def.duration.max) {
      const clamped = Math.min(def.duration.max, Math.max(def.duration.min, duration))
      issues.push({
        severity: 'warn',
        path: `${path}.duration`,
        code: 'clamped',
        message: `${def.name} runs ${def.duration.min}–${def.duration.max} s; ${duration} s became ${clamped} s`,
      })
      duration = clamped
    }

    let componentStyle = style
    if (c.energy !== undefined && c.energy !== null) {
      if (isOneOf(MOTION_ENERGIES, c.energy)) componentStyle = { ...style, energy: c.energy }
      else issues.push({ severity: 'error', path: `${path}.energy`, code: 'unknown-style', message: `unknown energy "${c.energy}"` })
    }
    const scale = ENERGY_TIME_SCALE[componentStyle.energy]

    const ctx: ComponentContext = {
      format: authored.format,
      style: componentStyle,
      color: (role) => (colorNames.has(role) ? `$${role}` : DEFAULT_COLORS[role]),
      font: (role) => (fontRoles.has(role) ? `$${role}` : DEFAULT_FONTS[role]),
      random: seededRandom(hashString(`${baseSeed}:${c.id}`)),
      t: (seconds) => seconds * scale,
      path,
      issues,
    }

    let parts: SpecElement[]
    try {
      parts = def.build({ ...c, duration }, ctx)
    } catch (err) {
      issues.push({
        severity: 'error',
        path,
        code: 'component-failed',
        message: `${def.name} could not be built: ${err instanceof Error ? err.message : String(err)}`,
      })
      return null
    }

    const id = claimId(c.id, `${path}.id`)
    const children = parts.map((p, i) => {
      if (!p.id.startsWith(`${c.id}-`)) {
        issues.push({ severity: 'warn', path: `${path}[part ${i}]`, code: 'unscoped-id', message: `${def.name} made a part "${p.id}" not prefixed with "${c.id}-"` })
      }
      return { ...p, id: claimId(p.id, `${path}[part ${i}]`) }
    })

    componentInstances[id] = {
      v: 1,
      name: c.component,
      input: jsonSafe({ ...c, duration, energy: componentStyle.energy }) as ClipComponentInstance['input'],
      seed: baseSeed,
      style: { ...componentStyle },
      ...(designRecord ? { design: designRecord } : {}),
    }

    return {
      id,
      kind: 'group',
      name: c.text ? `${def.label}: ${c.text}`.slice(0, 60) : def.label,
      at: c.at,
      duration,
      ...(c.layer !== undefined ? { layer: c.layer } : {}),
      children,
    }
  }

  /** A system waiting for its level's raw elements to be known (MI-P3). */
  interface PendingSystem {
    pending: true
    system: SpecSystem
    path: string
  }
  type Slot = SpecElement | PendingSystem
  const isPending = (s: Slot): s is PendingSystem => (s as PendingSystem).pending === true

  const systemEnv = (emitted: ReadonlyMap<string, ReadonlyArray<string>>): ExpandSystemEnv => ({
    makeContext: (systemId, path) => ({
      format: authored.format,
      style,
      color: (role) => (colorNames.has(role) ? `$${role}` : DEFAULT_COLORS[role]),
      font: (role) => (fontRoles.has(role) ? `$${role}` : DEFAULT_FONTS[role]),
      random: seededRandom(hashString(`${baseSeed}:${systemId}`)),
      t: (seconds) => seconds * ENERGY_TIME_SCALE[style.energy],
      path,
      issues,
    }),
    claimId,
    // A template is walked like any element (components inside it expand) but its own ids are NOT
    // reserved: only the copies a system emits are, under the system's prefix.
    resolveTemplate: (template, path) => {
      const outer = seenIds
      const instancesBefore = new Set(Object.keys(componentInstances))
      seenIds = new Set() // its own id scope: a template id may equal a real element id without either being renamed
      try {
        return walk([template], path)[0]
      } finally {
        seenIds = outer
        for (const id of Object.keys(componentInstances)) if (!instancesBefore.has(id)) delete componentInstances[id]
      }
    },
    emitted,
    issues,
  })

  const walk = (list: ReadonlyArray<AuthoredElement>, prefix: string): SpecElement[] => {
    const slots: Slot[] = []
    list.forEach((el, i) => {
      const path = `${prefix}[${i}]`
      if (el.kind === 'component') {
        const expanded = expandOne(el as SpecComponent, path)
        if (expanded) slots.push(expanded)
        return
      }
      if (el.kind === 'system') {
        slots.push({ pending: true, system: el as SpecSystem, path })
        return
      }
      if (el.kind === 'vector') {
        // A drawn asset (MI-P5): a placeholder rect now, the imported compound after the compile (`lowerVectors`).
        const vector = el as SpecVector
        if (typeof vector.asset !== 'string' || vector.asset.trim() === '') {
          issues.push({ severity: 'error', path: `${path}.asset`, code: 'vector-missing', message: 'a vector element names no asset; it was removed' })
          return
        }
        slots.push(vectorPlaceholder(vector, claimId(vector.id, `${path}.id`), authored.format))
        return
      }
      const raw = el as Exclude<AuthoredElement, SpecComponent | SpecSystem | SpecVector>
      const children = raw.children ? walk(raw.children, `${path}.children`) : undefined
      slots.push({ ...raw, id: claimId(raw.id, `${path}.id`), ...(children ? { children } : {}) } as SpecElement)
    })
    if (!slots.some(isPending)) return slots as SpecElement[]

    // Systems act on their siblings, so they run once every raw element at this level exists, in document order.
    let current: Slot[] = slots
    const emitted = new Map<string, string[]>()
    for (const marker of slots.filter(isPending)) {
      const level = current.filter((s): s is SpecElement => !isPending(s))
      const result = expandSystem(marker.system, level, marker.path, systemEnv(emitted))
      const updates = new Map((result?.update ?? []).map((e) => [e.id, e]))
      const removed = new Set(result?.remove ?? [])
      current = current.flatMap((s): Slot[] =>
        s === marker ? (result?.emit ?? []) : isPending(s) ? [s] : removed.has(s.id) ? [] : [updates.get(s.id) ?? s],
      )
      if (result) emitted.set(marker.system.id, result.emit.map((e) => e.id))
    }
    return current as SpecElement[]
  }

  const { motion: _motion, elements, ...rest } = authored
  // `rest.sfx` may hold event-bound cues (MI-P6); `buildVideo` lowers them right after this returns, so they are
  // never seen as `SpecSfx` by anything that matters. Seconds cues are already exactly `SpecSfx`.
  return { spec: { ...rest, elements: walk(elements, 'elements') } as VideoSpec, issues, style, componentInstances }
}
