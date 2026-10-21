/**
 * Named colour slots (PQ-2a). A fill or stroke item named `$accent` is the slot
 * `accent`; `LottieImportOptions.slots` (`{ accent: '#ff3d7f' }`) also binds
 * every STATIC fill or stroke of that colour. The importer writes one colour
 * prop per slot onto the child project's `composition` and a binding from it to
 * each shape's `shapeFill` / `shapeStroke`, so a palette can rebind the whole
 * animation with `instantiate`.
 *
 * Pure. A coloured key channel (an animated `c`) cannot rebind, because its keys
 * win over the authored colour; that is reported instead.
 */
import type { Binding, PropDef } from '../../composition/types'

export const SLOT_NAME_RE = /^\$([A-Za-z_][A-Za-z0-9_]{0,39})$/

/** `$accent` → `accent`; anything else → undefined. */
export function slotNameOf(nm: unknown): string | undefined {
  if (typeof nm !== 'string') return undefined
  const m = SLOT_NAME_RE.exec(nm.trim())
  return m ? m[1] : undefined
}

/** `#abc` / `#AABBCC` → `#aabbcc`; anything else → undefined. */
export function normalizeHex(value: string): string | undefined {
  const s = value.trim()
  const m3 = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(s)
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`.toLowerCase()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase()
  return undefined
}

export interface SlotUse {
  name: string
  value: string
  count: number
}

export interface SlotRegistry {
  /**
   * The slot a static fill/stroke belongs to, or undefined. `nm` is the style
   * item's name; `color` is the CSS colour the importer wrote (`#rrggbb` when opaque).
   */
  match(nm: unknown, color: string): { name: string; reason?: string } | undefined
  /** Record one binding (counted per slot). The first colour seen is the slot's default. */
  use(name: string, color: string): void
  props(): PropDef[]
  uses(): SlotUse[]
}

export function createSlotRegistry(options: Readonly<Record<string, string>> | undefined): SlotRegistry {
  const byColor = new Map<string, string>()
  for (const [name, value] of Object.entries(options ?? {})) {
    const hex = normalizeHex(value)
    if (hex && /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(name) && !byColor.has(hex)) byColor.set(hex, name)
  }
  const slots = new Map<string, SlotUse>()

  return {
    match(nm, color) {
      const named = slotNameOf(nm)
      const hex = normalizeHex(color)
      if (named !== undefined) {
        if (hex === undefined) return { name: named, reason: `slot $${named} has a translucent colour and cannot be rebound` }
        return { name: named }
      }
      if (hex !== undefined) {
        const viaOption = byColor.get(hex)
        if (viaOption !== undefined) return { name: viaOption }
      }
      return undefined
    },
    use(name, color) {
      const hex = normalizeHex(color)
      if (hex === undefined) return
      const existing = slots.get(name)
      if (existing) existing.count++
      else slots.set(name, { name, value: hex, count: 1 })
    },
    props() {
      return [...slots.values()].map((s) => ({
        name: s.name,
        type: 'color' as const,
        default: s.value,
        label: s.name.charAt(0).toUpperCase() + s.name.slice(1),
        description: `Lottie colour slot $${s.name}`,
      }))
    },
    uses() {
      return [...slots.values()].map((s) => ({ ...s }))
    },
  }
}

/** A binding from slot `prop` to `path` of clip `clipId` (a path through compounds). */
export function slotBinding(clipId: string, path: 'shapeFill' | 'shapeStroke', prop: string): Binding {
  return { clipId, path, prop }
}
