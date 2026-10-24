/**
 * units.ts — the author -> engine unit conversions (AV-1).
 *
 * Every function here is pure and total: given a finite number it returns a
 * finite number, never throws, never reads a clock. `compile.ts` is the only
 * caller that knows about `SpecIssue`; the clamp helpers below take the issue
 * list as a parameter so a caller can attribute a warning to the right path.
 */

import type { SpecDesign, SpecIssue } from './types'

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * Seconds -> a POSITION in frames. Copies `ops/apply.ts:110`'s `f()`: rounds
 * to the nearest frame and floors at 0 — a position can be the first frame
 * but never before it.
 */
export function toFrames(seconds: number, fps: number): number {
  const s = Number.isFinite(seconds) ? seconds : 0
  const f = Number.isFinite(fps) ? fps : 0
  return Math.max(0, Math.round(s * f))
}

/**
 * Seconds -> a DURATION in frames. Copies `ops/apply.ts:111`'s `d()`: rounds
 * and floors at 1 — a zero-length clip must be impossible, because the
 * engine's own `createClip` silently clamps to 1 and a spec that asked for 0
 * should not disagree with the document it produced.
 */
export function toDurationFrames(seconds: number, fps: number): number {
  const s = Number.isFinite(seconds) ? seconds : 0
  const f = Number.isFinite(fps) ? fps : 0
  return Math.max(1, Math.round(s * f))
}

/** Degrees, clockwise (the spec's convention) -> radians (the engine's). */
export function toRadians(degrees: number): number {
  const d = Number.isFinite(degrees) ? degrees : 0
  return (d * Math.PI) / 180
}

// ---------------------------------------------------------------------------
// The shape box model
// ---------------------------------------------------------------------------

export interface PixelSize {
  w: number
  h: number
}

export interface StageSize {
  width: number
  height: number
}

/** `Transform`'s `scale`/`scaleX`/`scaleY` for an exact `w x h` pixel box. */
export interface PixelBox {
  scale: 1
  scaleX: number
  scaleY: number
}

/**
 * An exact `w x h` stage-pixel box, in the engine's own box model
 * (`renderer/gpu/layers/shapePaint.ts` `resolveShapeRect`, explained at
 * `elements/compoundTemplates.ts:41-47`): a shape's box is
 * `scale x min(stageW, stageH)`, stretched per axis by `scaleX`/`scaleY`. So
 * an exact box is `scale: 1` with `scaleX = w / short` and `scaleY = h / short`,
 * where `short` is the shorter stage side.
 *
 * Degenerate input (a non-finite or non-positive stage side) returns
 * `scaleX`/`scaleY` of 0 rather than `Infinity`/`NaN`, so a caller that
 * forgets to guard still gets a document that reads as "invisible", not one
 * that fails `readProjectDocument`.
 */
export function pixelBox(size: PixelSize, stage: StageSize): PixelBox {
  const w = Number.isFinite(size.w) && size.w > 0 ? size.w : 0
  const h = Number.isFinite(size.h) && size.h > 0 ? size.h : 0
  const short = Math.min(stage.width, stage.height)
  if (!Number.isFinite(short) || short <= 0) return { scale: 1, scaleX: 0, scaleY: 0 }
  return { scale: 1, scaleX: w / short, scaleY: h / short }
}

// ---------------------------------------------------------------------------
// Tokens ($accent -> a design colour)
// ---------------------------------------------------------------------------

/** `design.colors` as a lookup map: `{ accent: '#22c55e' }`. */
export function designColorMap(design: SpecDesign | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of design?.colors ?? []) {
    if (typeof c?.name === 'string' && typeof c?.value === 'string') out[c.name] = c.value
  }
  return out
}

/** `design.fonts` as a role -> font id lookup map: `{ serif: 'playfair-display' }`. */
export function designFontMap(design: SpecDesign | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of design?.fonts ?? []) {
    if (typeof f?.role === 'string' && typeof f?.font === 'string') out[f.role] = f.font
  }
  return out
}

/**
 * `"$accent"` -> the value `tokens.accent` names; anything not starting with
 * `$` is returned unchanged (a literal hex colour, or already-resolved font
 * id). `undefined` means a `$name` with no entry — the caller's job to turn
 * that into an `error` issue rather than writing the literal `"$accent"`
 * string into the compiled document.
 */
export function resolveToken(value: string, tokens: Readonly<Record<string, string>>): string | undefined {
  if (!value.startsWith('$')) return value
  const name = value.slice(1)
  return Object.prototype.hasOwnProperty.call(tokens, name) ? tokens[name] : undefined
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/** `#rgb` or `#rrggbb` only — the spec's colour grammar (`types.ts`'s doc comment). */
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function isHexColor(value: string): boolean {
  return typeof value === 'string' && HEX_RE.test(value)
}

// ---------------------------------------------------------------------------
// Clamps — the same ranges `ops/sanitize.ts` enforces on assistant ops, so a
// spec and a plan agree on what "reasonable" means.
// ---------------------------------------------------------------------------

export const OPACITY_RANGE: readonly [number, number] = [0, 1]
export const SCALE_RANGE: readonly [number, number] = [0.01, 20]
/** Degrees; `ops/sanitize.ts`'s rotation range, in the spec's own unit. */
export const ROTATION_DEG_RANGE: readonly [number, number] = [-3600, 3600]
export const DURATION_SEC_RANGE: readonly [number, number] = [0.1, 60 * 30]
export const AT_SEC_RANGE: readonly [number, number] = [0, 60 * 60 * 3]

function clampValue(value: number, min: number, max: number): number {
  const v = Number.isFinite(value) ? value : min
  return Math.min(max, Math.max(min, v))
}

/**
 * Clamp `value` into `[min, max]`, pushing a `warn` issue at `path` when it
 * had to move. Returns the clamped value either way — a clamp is honoured,
 * never dropped (`SpecIssue`'s own doc comment: "warn — honoured, but changed").
 */
export function clampIssue(
  value: number,
  min: number,
  max: number,
  path: string,
  issues: SpecIssue[],
  code = 'clamped',
): number {
  const clamped = clampValue(value, min, max)
  if (clamped !== value) {
    issues.push({
      severity: 'warn',
      path,
      code,
      message: `${Number.isFinite(value) ? value : String(value)} was clamped to ${clamped}`,
    })
  }
  return clamped
}
