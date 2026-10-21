/**
 * Layout constraints, solved (PV-P3b).
 *
 * A clip's `layout` replaces its BASE transform — the value keyframes and
 * entry/exit motion are layered on top of — with one computed from the rest
 * boxes of the clips it references. This module is the solver: it orders the
 * constrained clips by dependency (Kahn's algorithm), reports cycles, missing
 * targets and unsupported clips/targets, and does the placement arithmetic.
 * `resolveTimeline.ts` calls it once per resolve, after the main loop has
 * built every clip's un-laid-out Active item, and rebuilds each laid-out
 * clip's item from the computed base afterward.
 *
 * Pure and DOM-free (the export worker imports the resolver too): every box
 * this module reads comes from `elementFrameFor`, and text without a
 * measurer is skipped rather than estimated.
 */

import type { Clip, LayoutAlign, LayoutEdge, LayoutRegion, Project, Transform } from '../types'
import type { ActiveFreehandClip, ActiveShapeClip, ActiveTextClip, LayoutError } from './scene'
import type { DrawRect } from '../renderer/gpu/layers/drawRect'
import type { TextMeasurer } from '../renderer/gpu/layers/textMeasure'
import { elementFrameFor } from '../renderer/gpu/layers/elementFrame'
import { freehandRestTransform } from '../renderer/gpu/layers/freehandPaint'
import { pathBounds } from '../renderer/gpu/layers/pathBounds'
import { typeDefaultTransform } from './keyframes'

/** EBU R 95 title-safe: 90% of each stage dimension. */
export const TITLE_SAFE_INSET = 0.05
/** Action-safe: 93% of each stage dimension. */
export const ACTION_SAFE_INSET = 0.035

export interface LayoutHost {
  stage: { width: number; height: number }
  /** Measures text for layout. Without it, a text box has no frame. */
  measure?: TextMeasurer
  clipById(id: string): Clip | undefined
  /**
   * `clip` at rest with `transform` as its base, as the painter draws it —
   * no keyframes, no entry/exit motion. `null` for a type this module cannot
   * frame (image, video, generator, compound, adjustment, audio) or a v1
   * freehand.
   */
  restItem(clip: Clip, transform: Transform): ActiveTextClip | ActiveShapeClip | ActiveFreehandClip | null
}

export interface LayoutSolution {
  bases: Map<string, Transform>
  errors: LayoutError[]
}

/** A number, or the fallback when the stored value is not one. */
function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Text, shape, and v2 freehand: the only clips a constraint can MOVE. */
function canMove(c: Clip): boolean {
  return c.type === 'text' || c.type === 'shape' || (c.type === 'freehand' && c.transformModel === 'v2')
}

/** Text, shape and freehand (any model): the only clips this module can FRAME. */
function canFrame(c: Clip): boolean {
  return c.type === 'text' || c.type === 'shape' || c.type === 'freehand'
}

/**
 * A clip's own base transform, before any constraint: its stored `transform`,
 * or its type default — except a freehand clip with neither `transform` nor
 * v2, which rests at its own path bounds (so anchoring to an undrawn
 * freehand's native position still works). `undefined` only when a freehand
 * clip's path has no bounds at all.
 */
function restBase(c: Clip, stage: { width: number; height: number }): Transform | undefined {
  if (c.transform) return c.transform
  if (c.type === 'freehand') {
    const bounds = pathBounds(c.pathData ?? '')
    return bounds ? freehandRestTransform(bounds, stage) : undefined
  }
  return typeDefaultTransform(c.type)
}

/** The box `c` occupies at rest with `base` as its transform, or `undefined` (text with no measurer, an unframeable type). */
function frameOf(host: LayoutHost, c: Clip, base: Transform): DrawRect | undefined {
  const item = host.restItem(c, base)
  if (!item) return undefined
  return elementFrameFor(item, host.stage, host.measure)
}

/**
 * Clamp a box of `size` into a region that starts at `start` and spans `len`:
 * centred when the region is smaller than the box, else kept inside it.
 */
function clampInto(v: number, size: number, start: number, len: number): number {
  if (size >= len) return start + (len - size) / 2
  return Math.min(Math.max(v, start), start + len - size)
}

interface SafeRect {
  x: number
  y: number
  w: number
  h: number
}

function safeRect(inset: number, stage: { width: number; height: number }): SafeRect {
  return {
    x: inset * stage.width,
    y: inset * stage.height,
    w: stage.width * (1 - 2 * inset),
    h: stage.height * (1 - 2 * inset),
  }
}

/** Where a box of `w` × `h` goes for `region`, in stage px (top-left corner). */
function placeInRegion(
  region: LayoutRegion,
  bx: number,
  by: number,
  w: number,
  h: number,
  stage: { width: number; height: number },
): [number, number] {
  const T = safeRect(TITLE_SAFE_INSET, stage)
  if (region === 'safe-title' || region === 'safe-action') {
    const R = region === 'safe-title' ? T : safeRect(ACTION_SAFE_INSET, stage)
    return [clampInto(bx, w, R.x, R.w), clampInto(by, h, R.y, R.h)]
  }
  let x: number
  if (region === 'left' || region === 'top-left' || region === 'bottom-left') x = T.x
  else if (region === 'right' || region === 'top-right' || region === 'bottom-right') x = T.x + T.w - w
  else x = stage.width / 2 - w / 2
  let y: number
  if (region === 'top' || region === 'top-left' || region === 'top-right') y = T.y
  else if (region === 'bottom' || region === 'bottom-left' || region === 'bottom-right') y = T.y + T.h - h
  else if (region === 'lower-third') y = clampInto(0.8 * stage.height - h / 2, h, T.y, T.h)
  else if (region === 'upper-third') y = clampInto(0.25 * stage.height - h / 2, h, T.y, T.h)
  else y = stage.height / 2 - h / 2
  return [x, y]
}

/** Position along one axis of an edge: start/center/end within the target's own span. */
function along(tStart: number, tLen: number, len: number, align: LayoutAlign): number {
  if (align === 'start') return tStart
  if (align === 'end') return tStart + tLen - len
  return tStart + tLen / 2 - len / 2
}

/** Where a box of `w` × `h` sits outside `edge` of target box `t`. */
function placeAgainst(
  anchorTo: { edge: LayoutEdge; align?: LayoutAlign; gap?: number },
  t: DrawRect,
  w: number,
  h: number,
): [number, number] {
  const align = anchorTo.align ?? 'center'
  const gap = anchorTo.gap ?? 0
  switch (anchorTo.edge) {
    case 'bottom':
      return [along(t.x, t.width, w, align), t.y + t.height + gap]
    case 'top':
      return [along(t.x, t.width, w, align), t.y - gap - h]
    case 'right':
      return [t.x + t.width + gap, along(t.y, t.height, h, align)]
    case 'left':
      return [t.x - gap - w, along(t.y, t.height, h, align)]
  }
}

/** `base` reshaped so its box becomes target box `t` grown by `padding` on every side. `null` when the shape has no usable side length. */
function fitShape(
  base: Transform,
  t: DrawRect,
  padding: number,
  stage: { width: number; height: number },
): Transform | null {
  const bx = t.x - padding
  const by = t.y - padding
  const w = t.width + 2 * padding
  const h = t.height + 2 * padding
  const scale = finite(base.scale, 0.5)
  const side = scale * Math.min(stage.width, stage.height)
  if (side <= 0) return null
  const ax = finite(base.anchor?.x, 0.5)
  const ay = finite(base.anchor?.y, 0.5)
  return {
    ...base,
    scale,
    scaleX: w / side,
    scaleY: h / side,
    rotation: t.rotation,
    x: (bx + ax * w) / stage.width,
    y: (by + ay * h) / stage.height,
  }
}

/**
 * Solve every constraint reachable from `dependents` (the laid-out clips of
 * one resolve, in scene order). Orders them by dependency (Kahn), reports a
 * cycle, a missing target or an unsupported clip/target once per clip id,
 * and returns the computed base transform for every clip it could place.
 */
export function solveLayout(host: LayoutHost, dependents: ReadonlyArray<Clip>): LayoutSolution {
  const errors: LayoutError[] = []
  const reported = new Set<string>()
  const failed = new Set<string>()
  const fail = (id: string, reason: LayoutError['reason']): void => {
    if (reported.has(id)) return
    reported.add(id)
    failed.add(id)
    errors.push({ clipId: id, reason })
  }

  const targetsOf = (c: Clip): string[] => {
    const ids = [c.layout?.anchorTo?.clip, c.layout?.fitTo?.clip].filter((v): v is string => !!v)
    return Array.from(new Set(ids))
  }

  // --- 1. Node collection: BFS from `dependents`, in the order given. -------
  const nodes = new Map<string, Clip>()
  const queue: Clip[] = []
  for (const c of dependents) {
    if (!nodes.has(c.id)) {
      nodes.set(c.id, c)
      queue.push(c)
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi]
    for (const id of targetsOf(c)) {
      if (nodes.has(id)) continue
      const t = host.clipById(id)
      if (!t) {
        fail(c.id, 'missing-target')
        continue
      }
      // A laid-out target is solved even when it is not on screen at this
      // frame; a target with no layout is not a node — it has no constraint
      // of its own, so `solve` reads it directly via `clipById`/`restBase`.
      if (t.layout) {
        nodes.set(t.id, t)
        queue.push(t)
      }
    }
  }

  // --- 2. Kahn: edge c -> t exists when t is a node. ------------------------
  const pending = new Map<string, number>()
  const dependentsOf = new Map<string, string[]>()
  const order = Array.from(nodes.keys())
  for (const id of order) {
    const c = nodes.get(id)!
    let p = 0
    for (const tid of targetsOf(c)) {
      if (!nodes.has(tid)) continue
      p++
      const list = dependentsOf.get(tid)
      if (list) list.push(id)
      else dependentsOf.set(tid, [id])
    }
    pending.set(id, p)
  }

  const bases = new Map<string, Transform>()
  const solved = new Set<string>()

  const solve = (c: Clip): void => {
    if (failed.has(c.id)) return
    if (!canMove(c)) {
      fail(c.id, 'unsupported')
      return
    }
    if (c.layout?.fitTo && c.type !== 'shape') {
      fail(c.id, 'unsupported')
      return
    }
    const base = restBase(c, host.stage)
    if (!base) return
    const f = frameOf(host, c, base)
    if (!f) return
    const layout = c.layout!
    let bx = f.x
    let by = f.y
    const w = f.width
    const h = f.height
    if (layout.region) {
      ;[bx, by] = placeInRegion(layout.region, bx, by, w, h, host.stage)
    }
    if (layout.pin) {
      const { left, right, top, bottom } = layout.pin
      if (left !== undefined) bx = left
      else if (right !== undefined) bx = host.stage.width - right - w
      if (top !== undefined) by = top
      else if (bottom !== undefined) by = host.stage.height - bottom - h
    }
    if (layout.anchorTo) {
      const t = host.clipById(layout.anchorTo.clip)
      if (!t || !canFrame(t)) {
        fail(c.id, 'unsupported')
        return
      }
      const tBase = bases.get(t.id) ?? restBase(t, host.stage)
      if (!tBase) return
      const tf = frameOf(host, t, tBase)
      if (!tf) return
      ;[bx, by] = placeAgainst(layout.anchorTo, tf, w, h)
    }
    if (layout.fitTo) {
      const t = host.clipById(layout.fitTo.clip)
      if (!t || !canFrame(t)) {
        fail(c.id, 'unsupported')
        return
      }
      const tBase = bases.get(t.id) ?? restBase(t, host.stage)
      if (!tBase) return
      const tf = frameOf(host, t, tBase)
      if (!tf) return
      const fitted = fitShape(base, tf, layout.fitTo.padding ?? 0, host.stage)
      if (!fitted) {
        fail(c.id, 'unsupported')
        return
      }
      bases.set(c.id, fitted)
      return
    }
    bases.set(c.id, {
      ...base,
      x: base.x + (bx - f.x) / host.stage.width,
      y: base.y + (by - f.y) / host.stage.height,
    })
  }

  const ready: string[] = order.filter((id) => pending.get(id) === 0)
  for (let ri = 0; ri < ready.length; ri++) {
    const id = ready[ri]
    solve(nodes.get(id)!)
    solved.add(id)
    for (const depId of dependentsOf.get(id) ?? []) {
      const left = (pending.get(depId) ?? 0) - 1
      pending.set(depId, left)
      if (left === 0) ready.push(depId)
    }
  }
  // Every node never popped (its dependency chain never reached pending 0) is
  // part of a cycle, including a clip anchored to itself.
  for (const id of order) {
    if (!solved.has(id)) fail(id, 'cycle')
  }

  return { bases, errors }
}

/**
 * True when any clip in `project` — including inside a compound's nested
 * project — carries `layout`. Lets the preview and export skip building a
 * text measurer for a project that never needs one.
 */
export function projectUsesLayout(project: Project): boolean {
  for (const list of Object.values(project.clips)) {
    for (const c of list) {
      if (c.layout) return true
      if (c.type === 'compound' && c.compound && projectUsesLayout(c.compound.project)) return true
    }
  }
  return false
}
