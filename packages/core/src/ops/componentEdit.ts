/**
 * Element-level edits of a generated graphic, as pure decisions (EG-P6).
 *
 * `setComponentField` and `setComponentItems` change the INTENT of a component
 * instance (its text, items, variant, energy, emphasis, duration). They must
 * produce exactly the pair of writes the Inspector panel makes: the merged
 * nested project and the new `component` record, with every hand edit kept.
 * `planInstanceUpdate` is the core twin of the host application's `planInstanceEdit`:
 * an op runs here, in core, and core cannot import the host application.
 *
 * `validateInstanceOverrides` checks a change against the component's own
 * `ComponentDef` (items min and max, variants, icon names, energies, duration
 * bounds), so a model that invents a variant or sends seven items to a
 * three-item component is told why instead of being half-applied.
 *
 * Pure: no engine, no clock. Never throws on hostile input.
 */

import { ICON_NAMES } from '../icons'
import type { Clip, Project, ProjectAuthored } from '../types'
import { COMPONENT_REGISTRY, resolveMotionStyle } from '../spec/components'
import { MOTION_ENERGIES, type ComponentItem, type ComponentName, type MotionStyle, type SpecComponent } from '../spec/components/types'
import { componentFields, expandInstance, reconcileCompound, type ReconcileReport } from '../spec/instance'
import type { ClipComponentInstance } from '../types'

/** Fields `setComponentField` may change. `duration` also resizes the compound on its own timeline. */
export const COMPONENT_FIELDS = ['text', 'sub', 'variant', 'energy', 'emphasis', 'duration'] as const
export type ComponentFieldName = (typeof COMPONENT_FIELDS)[number]

export const MAX_COMPONENT_TEXT = 200
export const MAX_ITEM_TEXT = 80
export const MAX_ITEM_SUB = 120
export const MAX_EMPHASIS_WORDS = 8

const ITEM_KEYS: ReadonlyArray<keyof ComponentItem> = ['text', 'sub', 'icon', 'value', 'style']

/** The `style` values an item may take, read from the derived Inspector schema so there is one list. */
function itemStyles(name: ComponentName): ReadonlyArray<string> {
  const def = COMPONENT_REGISTRY.get(name)
  const items = def ? componentFields(def).find((f) => f.key === 'items') : undefined
  return items?.itemFields?.find((f) => f.key === 'style')?.options ?? []
}

/**
 * Why `overrides` do not fit the component named `name`, or `null` when they do.
 * Looks only at the keys present, so a field change and an items change share one gate.
 */
export function validateInstanceOverrides(name: string, overrides: Partial<SpecComponent>): string | null {
  const def = COMPONENT_REGISTRY.get(name as ComponentName)
  if (!def) return `"${name}" comes from a newer version and cannot be edited here`

  if (overrides.text !== undefined && (typeof overrides.text !== 'string' || overrides.text.length > MAX_COMPONENT_TEXT)) {
    return `text must be a string of at most ${MAX_COMPONENT_TEXT} characters`
  }
  if (overrides.sub !== undefined && (typeof overrides.sub !== 'string' || overrides.sub.length > MAX_COMPONENT_TEXT)) {
    return `sub must be a string of at most ${MAX_COMPONENT_TEXT} characters`
  }
  if (overrides.variant !== undefined) {
    if (!def.variants || def.variants.length === 0) return `${def.label} has no variants`
    if (!def.variants.includes(overrides.variant)) return `${def.label} has no variant "${String(overrides.variant)}" (it offers ${def.variants.join(', ')})`
  }
  if (overrides.energy !== undefined && !(MOTION_ENERGIES as ReadonlyArray<string>).includes(overrides.energy)) {
    return `energy "${String(overrides.energy)}" is not one of ${MOTION_ENERGIES.join(', ')}`
  }
  if (overrides.emphasis !== undefined) {
    const e = overrides.emphasis
    if (!Array.isArray(e) || e.length > MAX_EMPHASIS_WORDS || e.some((w) => typeof w !== 'string')) {
      return `emphasis takes at most ${MAX_EMPHASIS_WORDS} words`
    }
  }
  if (overrides.duration !== undefined) {
    const d = overrides.duration
    if (typeof d !== 'number' || !Number.isFinite(d) || d < def.duration.min || d > def.duration.max) {
      return `${def.label} runs ${def.duration.min} to ${def.duration.max} seconds`
    }
  }
  if (overrides.items !== undefined) {
    if (!def.items) return `${def.label} takes no items`
    const items = overrides.items
    if (!Array.isArray(items) || items.length < def.items.min || items.length > def.items.max) {
      return `${def.label} takes ${def.items.min} to ${def.items.max} items, not ${Array.isArray(items) ? items.length : 'that'}`
    }
    const styles = itemStyles(name as ComponentName)
    for (let i = 0; i < items.length; i++) {
      const it = items[i] as unknown
      if (!it || typeof it !== 'object' || Array.isArray(it)) return `item ${i + 1} is not an item`
      const item = it as Record<string, unknown>
      for (const k of Object.keys(item)) if (!(ITEM_KEYS as ReadonlyArray<string>).includes(k)) return `item ${i + 1} has an unknown key "${k}"`
      if (item.text !== undefined && (typeof item.text !== 'string' || item.text.length > MAX_ITEM_TEXT)) return `item ${i + 1}: text is longer than ${MAX_ITEM_TEXT} characters`
      if (item.sub !== undefined && (typeof item.sub !== 'string' || item.sub.length > MAX_ITEM_SUB)) return `item ${i + 1}: sub is longer than ${MAX_ITEM_SUB} characters`
      if (item.icon !== undefined && (typeof item.icon !== 'string' || !ICON_NAMES.includes(item.icon))) return `item ${i + 1}: "${String(item.icon)}" is not an icon in the library`
      if (item.value !== undefined && (typeof item.value !== 'number' || !Number.isFinite(item.value))) return `item ${i + 1}: value must be a number`
      if (item.style !== undefined && (typeof item.style !== 'string' || !styles.includes(item.style))) return `item ${i + 1}: style "${String(item.style)}" is not one of ${styles.join(', ')}`
    }
  }
  return null
}

export type InstanceUpdatePlan =
  | {
      ok: true
      /** The nested project to commit: merged with the user's hand edits, or fresh when the component itself changed. */
      child: Project
      /** The new `component` record. */
      component: ClipComponentInstance
      /** The nested project the plan was made from: pass as `expectedChild` so a concurrent change is refused. */
      expectedChild: Project
      /** Empty when the component was replaced by a different one (nothing to reconcile against). */
      report: ReconcileReport
      /** `true` when `update.name` named a different component: hand edits are not carried over. */
      replaced: boolean
    }
  | { ok: false; reason: string }

export interface InstanceUpdate {
  /** A different component to become. Absent = the same one. */
  name?: string
  /** Input fields to change; the rest of the stored input is kept. */
  overrides: Partial<SpecComponent>
}

function partIdsAreUnique(child: Project): boolean {
  const seen = new Set<string>()
  for (const clip of Object.values(child.clips).flat()) {
    if (!clip.partId || seen.has(clip.partId)) return false
    seen.add(clip.partId)
  }
  return true
}

const EMPTY_REPORT = (): ReconcileReport => ({ kept: [], added: [], removed: [], reflowed: [], leftDeleted: [] })

/**
 * Plan one intent change on the component instance `clip`, merging with the
 * hand edits in its nested project (`reconcileCompound`). An empty `overrides`
 * with no `name` changes nothing. Never throws; a refusal is a reason.
 */
export function planInstanceUpdate(clip: Clip, authored: ProjectAuthored | undefined, update: InstanceUpdate): InstanceUpdatePlan {
  if (clip.type !== 'compound' || !clip.compound) return { ok: false, reason: `"${clip.name}" is not a graphic` }
  const record = clip.component
  if (!record) return { ok: false, reason: `"${clip.name}" is not a generated component, so it has no fields to edit` }
  const targetName = update.name ?? record.name
  const invalid = validateInstanceOverrides(targetName, update.overrides)
  if (invalid) return { ok: false, reason: invalid }
  if (!COMPONENT_REGISTRY.has(record.name as ComponentName)) return { ok: false, reason: `"${record.name}" comes from a newer version and cannot be edited here` }

  const child = clip.compound.project
  const piece = authored?.spec as { motion?: Partial<MotionStyle>; duration?: unknown } | undefined
  const ctx = {
    format: { width: child.stage.width, height: child.stage.height, fps: child.fps },
    // Polish ran with the PIECE's style; the instance only stores the component's own.
    ...(piece ? { pieceStyle: resolveMotionStyle(piece.motion) } : {}),
    ...(typeof piece?.duration === 'number' ? { pieceDuration: piece.duration } : {}),
  }

  const replaced = targetName !== record.name
  if (replaced) {
    const next: ClipComponentInstance = {
      ...record,
      name: targetName,
      input: { ...record.input, ...update.overrides, component: targetName } as ClipComponentInstance['input'],
    }
    const fresh = expandInstance(next, ctx)
    if (!fresh.ok) return { ok: false, reason: `${targetName} could not be built from that input` }
    return { ok: true, child: fresh.child, component: fresh.component, expectedChild: child, report: EMPTY_REPORT(), replaced: true }
  }

  const baseline = expandInstance(record, ctx)
  if (!baseline.ok) return { ok: false, reason: 'that component could not be rebuilt from its stored input' }
  const incoming = expandInstance(record, ctx, update.overrides)
  if (!incoming.ok) return { ok: false, reason: 'that change could not be applied to this component' }
  if (!partIdsAreUnique(baseline.child) || !partIdsAreUnique(incoming.child)) {
    return { ok: false, reason: "this component's parts cannot be matched up, so it cannot be re-flowed safely" }
  }
  const merged = reconcileCompound(child, baseline.child, incoming.child)
  return { ok: true, child: merged.project, component: incoming.component, expectedChild: child, report: merged.report, replaced: false }
}
