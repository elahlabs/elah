/**
 * Optional renderer features, loaded on first use (CONV-8).
 *
 * A project that uses no effects, generators, sequence clips, roto masks or
 * audio Enhance downloads none of their code. Each feature is ONE module
 * behind a literal dynamic `import()` (bundlers split on literal specifiers
 * only), and this file is the ONLY place those imports live.
 *
 *   effects     EffectChain + every GPU effect, masks, blends, mattes, GPU
 *               transitions, compound targets' chain half
 *   generators  GeneratorLayer + the generator painter
 *   sequences   SequenceLayer + its frame provider / reader
 *   rotoMasks   RotoMaskLayer + its frame provider
 *   enhance     the Enhance audio chain + the denoise worklet source
 *
 * Contract:
 *  - `loadFeature` shares one promise per feature; a failed load is dropped
 *    from the cache (so a later request retries) and rejects to every waiter.
 *  - `getLoadedFeature` is the synchronous read the renderer uses while
 *    drawing; null until the load finished.
 *  - `featuresForProject` / `prepareFeatures` decide from the PROJECT (nested
 *    compounds included) what a host or an export must have before frame 0.
 *    The resolver never calls any of this: it stays synchronous and pure.
 *
 * The export worker does NOT use this loader: it keeps static imports, because
 * a relative dynamic import inside a blob worker (cross-origin CDN case, see
 * `utils/workerUrl.ts`) has no base URL to resolve against.
 */

import { MAX_COMPOUND_DEPTH, type Clip, type Project } from '../../types'

export type FeatureId = 'effects' | 'generators' | 'sequences' | 'rotoMasks' | 'enhance'

/** The module each feature resolves to. Type-only imports: nothing here is loaded eagerly. */
export interface FeatureModules {
  effects: typeof import('./EffectChain')
  generators: typeof import('./layers/GeneratorLayer')
  sequences: typeof import('./layers/SequenceLayer')
  rotoMasks: typeof import('./layers/RotoMaskLayer')
  enhance: typeof import('../../media/audio/enhanceFeature')
}

type Loaders = { [K in FeatureId]: () => Promise<FeatureModules[K]> }

/** Literal specifiers, one per feature. Do not build these from variables. */
const LOADERS: Loaders = {
  effects: () => import('./EffectChain'),
  generators: () => import('./layers/GeneratorLayer'),
  sequences: () => import('./layers/SequenceLayer'),
  rotoMasks: () => import('./layers/RotoMaskLayer'),
  enhance: () => import('../../media/audio/enhanceFeature'),
}

export const FEATURE_IDS: readonly FeatureId[] = ['effects', 'generators', 'sequences', 'rotoMasks', 'enhance']

const inflight = new Map<FeatureId, Promise<unknown>>()
const loaded = new Map<FeatureId, unknown>()
/** Features whose load failed, with the error; read by `featureError`. */
const failed = new Map<FeatureId, unknown>()
let loaders: Loaders = LOADERS

/** Start (or join) the load of one feature. */
export function loadFeature<K extends FeatureId>(id: K): Promise<FeatureModules[K]> {
  const done = loaded.get(id)
  if (done) return Promise.resolve(done as FeatureModules[K])
  const pending = inflight.get(id)
  if (pending) return pending as Promise<FeatureModules[K]>
  const p = loaders[id]().then(
    (mod) => {
      loaded.set(id, mod)
      failed.delete(id)
      inflight.delete(id)
      return mod
    },
    (err: unknown) => {
      inflight.delete(id)
      failed.set(id, err)
      throw err
    },
  )
  inflight.set(id, p)
  return p as Promise<FeatureModules[K]>
}

/** The loaded module, or null while it is not (yet) available. Never starts a load. */
export function getLoadedFeature<K extends FeatureId>(id: K): FeatureModules[K] | null {
  return (loaded.get(id) as FeatureModules[K] | undefined) ?? null
}

/** The error of the last failed load of `id`, if it has not succeeded since. */
export function featureError(id: FeatureId): unknown {
  return failed.get(id)
}

/** Whether a feature is loaded, loading, or neither. For tests and diagnostics. */
export function featureState(id: FeatureId): 'loaded' | 'loading' | 'failed' | 'idle' {
  if (loaded.has(id)) return 'loaded'
  if (inflight.has(id)) return 'loading'
  return failed.has(id) ? 'failed' : 'idle'
}

/**
 * Which optional features this project needs, nested compounds included.
 * Pure: reads the project, loads nothing.
 *
 * `effects` also covers everything that goes through the effect chain without
 * being an effect: masks, blend modes, mattes, adjustment clips, transitions
 * and compounds (a compound renders its nested scene into a chain target).
 */
export function featuresForProject(project: Pick<Project, 'clips'> & { transitions?: Project['transitions'] }): Set<FeatureId> {
  const need = new Set<FeatureId>()
  scan(project, 0, need)
  return need
}

function scan(
  project: Pick<Project, 'clips'> & { transitions?: Project['transitions'] },
  depth: number,
  need: Set<FeatureId>,
): void {
  if (depth > MAX_COMPOUND_DEPTH) return
  if (project.transitions && project.transitions.length > 0) need.add('effects')
  for (const list of Object.values(project.clips)) {
    for (const clip of list as Clip[]) {
      if (clip.effects && clip.effects.length > 0) need.add('effects')
      if (clip.mask || clip.matte) need.add('effects')
      if (clip.blend && clip.blend !== 'normal') need.add('effects')
      switch (clip.type) {
        case 'adjustment':
          need.add('effects')
          break
        case 'generator':
          need.add('generators')
          break
        case 'sequence':
          need.add('sequences')
          break
        case 'video':
          if (clip.roto) need.add('rotoMasks')
          break
        case 'compound':
          need.add('effects')
          if (clip.compound) scan(clip.compound.project, depth + 1, need)
          break
        default:
          break
      }
      if (clip.audio?.enhance && (clip.audio.enhance.noise > 0 || clip.audio.enhance.voice > 0)) need.add('enhance')
    }
  }
}

/**
 * Load every feature the project needs. Resolves when all are loaded and
 * rejects with the first failure: an export must never silently skip a
 * feature, and a host that prepares a project learns about a failed chunk.
 */
export async function prepareFeatures(
  project: Pick<Project, 'clips'> & { transitions?: Project['transitions'] },
): Promise<void> {
  const need = featuresForProject(project)
  await Promise.all([...need].map((id) => loadFeature(id)))
}

/** Test seam: replace the loaders and forget everything loaded. Returns a restore function. */
export function __setFeatureLoadersForTests(next: Partial<Loaders> | null): () => void {
  const previous = loaders
  loaders = next ? ({ ...LOADERS, ...next } as Loaders) : LOADERS
  inflight.clear()
  loaded.clear()
  failed.clear()
  return () => {
    loaders = previous
    inflight.clear()
    loaded.clear()
    failed.clear()
  }
}
