/**
 * Icons for generated video (AV-2).
 *
 * ---------------------------------------------------------------------------
 * Why vendored path data and not a dependency
 * ---------------------------------------------------------------------------
 * A generated piece needs glyphs — a person, a rocket, a chart — and the engine
 * has no icon set. `lucide-react` (ISC) is already in the tree, but it is a
 * REACT component library: importing it into `packages/core` would put JSX in
 * the renderer and a React dependency in the export worker, for the sake of
 * some path strings.
 *
 * So the path data is vendored, the same way the OFL fonts are: a generated
 * data file plus the upstream LICENSE, with the generator checked in so the set
 * can be regenerated and audited rather than trusted. `scripts/build-icons.mjs`
 * reads `node_modules/lucide-react/dist/esm/icons/*.js` and writes `data.ts`.
 *
 * ---------------------------------------------------------------------------
 * One icon is ONE `d` string
 * ---------------------------------------------------------------------------
 * An engine `path` shape holds a single `shapePath`, but a Lucide icon is a
 * LIST of elements — paths, circles, lines, polylines, rects. The generator
 * lowers every one of them to path syntax and concatenates the subpaths, which
 * is exactly what a stroke renderer needs: a circle becomes two arcs, a
 * polyline becomes `M ... L ...`, and the result draws identically because a
 * stroke does not care where one subpath ends and the next begins.
 *
 * This is also why icons are STROKE art with no fill: `shapeStrokeCap` and
 * `shapeStrokeJoin` are round to match Lucide's own rendering, and the fill is
 * transparent. An icon drawn with a fill would be a blob.
 */

import { ICON_DATA } from './data'

/** A vendored icon: `d` in the `viewBox` user space. */
export interface IconPath {
  /** Always 24 for this set, kept explicit so the fit maths reads honestly. */
  viewBox: { x: number; y: number; width: number; height: number }
  /** Concatenated subpaths, in `viewBox` units. */
  d: string
}

/** The stroke width Lucide draws at, in the 24-unit user space. */
export const ICON_STROKE_UNITS = 2

/** Every icon name, sorted. This is the list the prompt vocabulary offers. */
export const ICON_NAMES: ReadonlyArray<string> = Object.keys(ICON_DATA).sort()

/**
 * Names an author is likely to reach for that are not what the set calls them.
 *
 * Kept small and obvious on purpose: this is a courtesy for near-misses, not a
 * thesaurus. A name that resolves through here is still reported, so a spec
 * that leans on it can be corrected.
 */
export const ICON_SYNONYMS: Readonly<Record<string, string>> = {
  people: 'users',
  person: 'user',
  audience: 'users',
  money: 'banknote',
  cash: 'banknote',
  revenue: 'trending-up',
  growth: 'trending-up',
  decline: 'trending-down',
  time: 'clock',
  speed: 'gauge',
  idea: 'lightbulb',
  warning: 'triangle-alert',
  tick: 'check',
  cross: 'x',
  cart: 'shopping-cart',
  chart: 'chart-column',
  graph: 'chart-line',
  email: 'mail',
  phone: 'smartphone',
  location: 'map-pin',
  security: 'shield',
  team: 'users',
  customer: 'user',
  launch: 'rocket',
}

/**
 * Resolve a name the author wrote to one this set has.
 *
 * Returns `null` rather than guessing when nothing matches: the compiler turns
 * that into an issue and draws a plain badge, which is a visible, correctable
 * outcome. Silently substituting an unrelated glyph is not.
 */
export function resolveIconName(name: string): string | null {
  const key = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
  if (!key) return null
  if (key in ICON_DATA) return key
  const synonym = ICON_SYNONYMS[key]
  if (synonym && synonym in ICON_DATA) return synonym
  // A trailing plural is the other common near-miss ("rockets").
  if (key.endsWith('s') && key.slice(0, -1) in ICON_DATA) return key.slice(0, -1)
  return null
}

/** The path data for a name, after synonym resolution. `null` if unknown. */
export function iconPath(name: string): IconPath | null {
  const resolved = resolveIconName(name)
  if (!resolved) return null
  const d = ICON_DATA[resolved]
  if (!d) return null
  return { viewBox: { x: 0, y: 0, width: 24, height: 24 }, d }
}

export { ICON_DATA }
