/**
 * insertComponentInstance (EG-P5): drop ONE motion component onto a live
 * timeline as an editable instance.
 *
 *   SpecComponent ──buildVideo──▶ Project ──layProject──▶ live engine
 *
 * This is the same expand -> polish -> compile -> lay path a generated video
 * takes, scoped to one component and placed at a frame instead of after the
 * timeline's end. The compound clip carries `component` and its parts carry
 * `partId` (EG-P1), so the EG-P2 Inspector panel edits it like any generated
 * graphic.
 *
 * What it guarantees, and how:
 *   - ONE undo step: `layProject` is a single `engine.batch`.
 *   - A NEW elements track: `layProject` appends every compiled track above
 *     whatever exists, so no existing clip is ever moved or overlapped.
 *   - The stage never changes: the format handed to the compiler IS the live
 *     stage and fps (there is no format parameter to get wrong), so even
 *     `layProject`'s "adopt the stage when empty" rule sets the same size.
 *   - `Project.authored` is read (design tokens, motion energy) and never
 *     written: a graphic must not replace the document a generated video came
 *     from.
 *   - Nothing is written when the component is unknown or expands with an
 *     error issue.
 *
 * Camera and ambient are switched off: they act on top-level elements, and a
 * single graphic has no beats to push on and no backdrop to add. The piece
 * duration given to polish is the component's end plus a second, so polish
 * never treats the component as spanning the whole piece (it would skip the
 * exit); EG-P2's re-expansion baseline then equals what is stored.
 */

import type { TimelineEngine } from '../editor/TimelineEngine'
import type { ApplyResult } from '../ops/types'
import type { Clip } from '../types'
import { buildVideo } from './build'
import { COMPONENT_REGISTRY, resolveMotionStyle } from './components'
import { DEFAULT_MOTION_STYLE, type AuthoredSpec, type ComponentName, type MotionStyle, type SpecComponent } from './components/types'
import { layProject } from './layProject'
import type { SpecDesign, SpecIssue } from './types'

export interface InsertInstanceOptions {
  /** The frame the compound starts at, on the live timeline's own fps. */
  atFrame: number
  /** Only `energy` is read: it becomes the component's own `energy` when it differs from the piece's. */
  style?: Partial<MotionStyle>
  /** Design tokens. Absent: the project's `authored.spec.design`, else none. */
  design?: SpecDesign
  /** The expansion seed; the same seed gives byte-identical parts. */
  seed: number
  /** Undo label. Default: "Add <component label>". */
  description?: string
}

export type InsertInstanceResult =
  | { ok: true; clipId: string; trackId: string; issues: SpecIssue[]; result: ApplyResult }
  | { ok: false; reason: 'unknown-component' | 'expansion-failed' | 'invalid-frame'; issues: SpecIssue[] }

interface AuthoredLike {
  design?: SpecDesign
  motion?: Partial<MotionStyle>
}

export function insertComponentInstance(
  engine: TimelineEngine,
  component: SpecComponent,
  opts: InsertInstanceOptions,
): InsertInstanceResult {
  const def = COMPONENT_REGISTRY.get(component.component as ComponentName)
  if (!def) {
    return {
      ok: false,
      reason: 'unknown-component',
      issues: [{ severity: 'error', path: 'component', code: 'unknown-component', message: `unknown component "${component.component}"` }],
    }
  }
  if (!Number.isFinite(opts.atFrame) || opts.atFrame < 0) {
    return { ok: false, reason: 'invalid-frame', issues: [] }
  }

  const live = engine.getProject()
  const fps = live.fps > 0 ? live.fps : 30
  const atFrame = Math.round(opts.atFrame)
  const atSec = atFrame / fps

  const authored = live.authored?.spec as AuthoredLike | undefined
  const design = opts.design ?? authored?.design
  const piece = resolveMotionStyle(authored?.motion ?? DEFAULT_MOTION_STYLE)
  const energy = opts.style?.energy
  const input: SpecComponent = {
    ...component,
    kind: 'component',
    at: atSec,
    ...(energy && energy !== piece.energy ? { energy } : {}),
  }

  const spec: AuthoredSpec = {
    format: { width: live.stage.width, height: live.stage.height, fps },
    duration: atSec + (input.duration > 0 ? input.duration : def.duration.default) + 1,
    ...(design ? { design } : {}),
    motion: { ...piece, camera: false, ambient: 'none' },
    elements: [input],
  }

  const built = buildVideo(spec, { seed: opts.seed })
  const errors = built.issues.filter((i) => i.severity === 'error' && i.code !== 'unknown-token')
  const group = Object.values(built.project.clips)
    .flat()
    .find((c: Clip) => c.component && c.partId === input.id)
  if (errors.length > 0 || !group) {
    return { ok: false, reason: 'expansion-failed', issues: built.issues }
  }

  const result = layProject(engine, built.project, { description: opts.description ?? `Add ${def.label}` })
  const clipId = result.touched.added.find((id) => engine.findClip(id)?.clip.component)
  const found = clipId ? engine.findClip(clipId) : null
  if (!clipId || !found) return { ok: false, reason: 'expansion-failed', issues: built.issues }

  const end = found.clip.startFrame + found.clip.durationFrames
  result.range = { startFrame: found.clip.startFrame, endFrame: end }
  return { ok: true, clipId, trackId: found.clip.trackId, issues: built.issues, result }
}
