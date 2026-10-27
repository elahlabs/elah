/**
 * buildVideo — the one call a client makes: authored document in, Project out.
 *
 *   AuthoredSpec ──expandComponents──▶ VideoSpec ──polishSpec──▶ VideoSpec ──compileVideoSpec──▶ Project
 *   (components + systems)                                           │              └──lowerAuthoredFields──▶ matte / fxKeys / path keys (MI-P3)
 *                                                                    └──lintSpec──▶ quality warnings
 *
 * Issues from every stage are returned together, in stage order, so a plan
 * card or a repair prompt sees one list. `expandedSpec` is the polished,
 * component-free document — what was actually compiled — for debugging and for
 * a repair call that wants to show the model what its components became.
 */

import { compileVideoSpec, type CompileStampOptions } from './compile'
import { expandComponents } from './components'
import type { AuthoredSpec, MotionStyle } from './components/types'
import { lintSpec, polishSpec } from './polish'
import { lowerSfx } from './sfxLowering'
import { lowerAuthoredFields } from './systems/lowering'
import { lowerVectors } from './vectorLowering'
import { withSeededIds } from '../utils/id'
import type { SvgNode } from '../vector/svg/types'
import type { CompileResult, VideoSpec } from './types'

export interface BuildOptions extends CompileStampOptions {
  /** Default true. False compiles the expanded spec exactly as authored. */
  polish?: boolean
  /**
   * Parsed SVGs by asset name, for `vector` elements (MI-P5). A `vector` whose name is not here is a `vector-missing`
   * error and is removed. Ignored by a document with no `vector`.
   */
  vectors?: Record<string, SvgNode>
}

export interface BuildResult extends CompileResult {
  expandedSpec: VideoSpec
  style: MotionStyle
  /** The expansion seed actually used: `opts.seed ?? 1`, which is not always what the compiler was given (EG-P1). */
  seed: number
}

export function buildVideo(authored: AuthoredSpec, opts: BuildOptions = {}): BuildResult {
  const seed = opts.seed ?? 1
  const expandedRaw = expandComponents(authored, { seed })
  // Event-bound sound cues are read off the expanded elements' own keys and presets, before polish adds its own (MI-P6).
  // A document with no `sfx` takes the old path untouched; seconds cues come back as the very same objects.
  const sfx = lowerSfx(authored.sfx, expandedRaw.spec.elements, authored.format?.fps)
  const expanded = authored.sfx === undefined ? expandedRaw : { ...expandedRaw, spec: { ...expandedRaw.spec, sfx: sfx.sfx }, issues: [...expandedRaw.issues, ...sfx.issues] }
  const polished =
    opts.polish === false ? { spec: expanded.spec, issues: [] } : polishSpec(expanded.spec, expanded.style, { seed })
  const compiled = compileVideoSpec(polished.spec, { ...opts, componentInstances: expanded.componentInstances })
  // matte / fxKeys / crossMorph path keys need compiled clip and effect ids: applied to the Project in place (MI-P3).
  // The keys it writes mint ids, so it runs in its own seeded stream (derived from the seed, not a replay of the compiler's)
  // or two builds of one seed would differ in key ids.
  const lowered =
    opts.seed === undefined
      ? lowerAuthoredFields(polished.spec, compiled)
      : withSeededIds((Math.imul(opts.seed, 0x9e3779b1) ^ 0x7f4a7c15) >>> 0, () => lowerAuthoredFields(polished.spec, compiled))
  // Drawn assets replace their placeholder clips last, so the matte / effects / keys lowered above are carried over (MI-P5).
  // The importer mints ids, so this too runs in its own seeded stream.
  const vectorIssues =
    opts.seed === undefined
      ? lowerVectors(polished.spec, compiled, opts.vectors)
      : withSeededIds((Math.imul(opts.seed, 0x85ebca6b) ^ 0x2c1b3c6d) >>> 0, () => lowerVectors(polished.spec, compiled, opts.vectors))
  return {
    ...compiled,
    issues: [...expanded.issues, ...polished.issues, ...compiled.issues, ...lowered, ...vectorIssues, ...lintSpec(polished.spec)],
    expandedSpec: polished.spec,
    style: expanded.style,
    seed,
  }
}
