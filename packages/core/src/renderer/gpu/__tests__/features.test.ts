/**
 * Optional renderer features (CONV-8): which a project needs, one shared load
 * per feature, a failure that is surfaced, and the two lazy wrappers the
 * renderer registers in their place.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Clip, Project } from '../../../types'
import {
  FEATURE_IDS,
  __setFeatureLoadersForTests,
  featureError,
  featureState,
  featuresForProject,
  getLoadedFeature,
  loadFeature,
  prepareFeatures,
} from '../features'
import { LazyEffectChain } from '../LazyEffectChain'
import { LazyLayer } from '../layers/LazyLayer'
import type { LayerContext } from '../layers/types'

function clip(partial: Record<string, unknown>): Clip {
  return {
    id: 'c' + Math.random().toString(36).slice(2, 8),
    trackId: 't',
    type: 'shape',
    startFrame: 0,
    durationFrames: 30,
    ...partial,
  } as unknown as Clip
}

function project(clips: Clip[], extra: Partial<Project> = {}): Pick<Project, 'clips'> & Partial<Project> {
  return { clips: { t: clips }, ...extra }
}

const NO_FEATURES = project([clip({ type: 'shape' }), clip({ type: 'text' }), clip({ type: 'video' }), clip({ type: 'image' })])

describe('featuresForProject', () => {
  it('needs nothing for shapes, text, video and images', () => {
    expect([...featuresForProject(NO_FEATURES)]).toEqual([])
  })

  it('detects effects, masks, mattes, blends, adjustments and transitions as the effects feature', () => {
    const cases: Array<Clip | Partial<Project>> = [
      clip({ effects: [{ kind: 'vignette', enabled: true, params: {} }] }),
      clip({ mask: { kind: 'rect' } }),
      clip({ matte: { sourceClipId: 'x', kind: 'alpha', invert: false } }),
      clip({ blend: 'multiply' }),
      clip({ type: 'adjustment' }),
    ]
    for (const c of cases) {
      expect([...featuresForProject(project([c as Clip]))]).toEqual(['effects'])
    }
    expect([...featuresForProject(project([], { transitions: [{ id: 'tr' }] as Project['transitions'] }))]).toEqual(['effects'])
  })

  it('does not treat blend normal or an empty effects list as needing the chain', () => {
    expect([...featuresForProject(project([clip({ blend: 'normal', effects: [] })]))]).toEqual([])
  })

  it('maps generator, sequence, roto and Enhance clips to their own feature', () => {
    expect([...featuresForProject(project([clip({ type: 'generator' })]))]).toEqual(['generators'])
    expect([...featuresForProject(project([clip({ type: 'sequence' })]))]).toEqual(['sequences'])
    expect([...featuresForProject(project([clip({ type: 'video', roto: { mode: 'overlay' } })]))]).toEqual(['rotoMasks'])
    expect([...featuresForProject(project([clip({ type: 'audio', audio: { enhance: { noise: 0.5, voice: 0 } } })]))]).toEqual(['enhance'])
    // Enhance with both strengths at zero does nothing, so it needs nothing.
    expect([...featuresForProject(project([clip({ type: 'audio', audio: { enhance: { noise: 0, voice: 0 } } })]))]).toEqual([])
  })

  it('descends into nested compounds, and a compound itself needs the chain', () => {
    const inner = project([clip({ type: 'generator' })])
    const outer = project([clip({ type: 'compound', compound: { project: inner } })])
    expect([...featuresForProject(outer)].sort()).toEqual(['effects', 'generators'])
    // Three levels down.
    const deep = project([clip({ type: 'compound', compound: { project: outer } })])
    expect([...featuresForProject(deep)].sort()).toEqual(['effects', 'generators'])
  })

  it('stops descending past the compound depth limit', () => {
    let p = project([clip({ type: 'sequence' })])
    for (let i = 0; i < 8; i++) p = project([clip({ type: 'compound', compound: { project: p } })])
    expect(featuresForProject(p).has('sequences')).toBe(false)
  })
})

describe('loadFeature', () => {
  let restore: (() => void) | null = null
  afterEach(() => {
    restore?.()
    restore = null
  })

  function stub(overrides: Record<string, () => Promise<unknown>> = {}) {
    const calls: Record<string, number> = {}
    const loaders: Record<string, () => Promise<unknown>> = {}
    for (const id of FEATURE_IDS) {
      calls[id] = 0
      loaders[id] =
        overrides[id] ??
        (async () => {
          calls[id]!++
          return { id }
        })
    }
    restore = __setFeatureLoadersForTests(loaders as never)
    return calls
  }

  it('loads nothing until asked, then once, and getLoadedFeature reads it synchronously', async () => {
    const calls = stub()
    expect(getLoadedFeature('effects')).toBeNull()
    expect(featureState('effects')).toBe('idle')
    const mod = await loadFeature('effects')
    expect(mod).toEqual({ id: 'effects' })
    expect(getLoadedFeature('effects')).toBe(mod)
    expect(featureState('effects')).toBe('loaded')
    await loadFeature('effects')
    expect(calls.effects).toBe(1)
    expect(calls.generators).toBe(0)
  })

  it('concurrent requests share one promise and one import', async () => {
    const calls = stub()
    const a = loadFeature('generators')
    const b = loadFeature('generators')
    expect(featureState('generators')).toBe('loading')
    expect(a).toBe(b)
    await Promise.all([a, b])
    expect(calls.generators).toBe(1)
  })

  it('surfaces a failure to every waiter, keeps nothing cached, and retries on the next ask', async () => {
    let n = 0
    stub({
      sequences: async () => {
        n++
        if (n === 1) throw new Error('chunk 404')
        return { ok: true }
      },
    })
    const first = loadFeature('sequences')
    await expect(first).rejects.toThrow('chunk 404')
    expect(featureState('sequences')).toBe('failed')
    expect((featureError('sequences') as Error).message).toBe('chunk 404')
    expect(getLoadedFeature('sequences')).toBeNull()
    await expect(loadFeature('sequences')).resolves.toEqual({ ok: true })
    expect(featureState('sequences')).toBe('loaded')
    expect(featureError('sequences')).toBeUndefined()
  })

  it('prepareFeatures loads exactly what the project needs and rejects when one load fails', async () => {
    const calls = stub()
    await prepareFeatures(project([clip({ effects: [{ kind: 'vignette', enabled: true, params: {} }] }), clip({ type: 'generator' })]))
    expect(calls.effects).toBe(1)
    expect(calls.generators).toBe(1)
    expect(calls.sequences).toBe(0)
    expect(calls.rotoMasks).toBe(0)
    expect(calls.enhance).toBe(0)

    stub({ sequences: async () => Promise.reject(new Error('offline')) })
    await expect(prepareFeatures(project([clip({ type: 'sequence' })]))).rejects.toThrow('offline')
  })

  it('prepareFeatures on a project with no optional features loads nothing', async () => {
    const calls = stub()
    await prepareFeatures(NO_FEATURES)
    expect(Object.values(calls).reduce((a, b) => a + b, 0)).toBe(0)
  })
})

describe('LazyLayer', () => {
  let restore: (() => void) | null = null
  afterEach(() => {
    restore?.()
    restore = null
    vi.restoreAllMocks()
  })
  const ctx = { gl: {} } as unknown as LayerContext

  it('holds acquires while loading, then replays them into the real layer and signals once', async () => {
    const events: string[] = []
    const real = {
      acquire: (item: { id: string }) => events.push('acquire:' + item.id),
      release: (id: string) => events.push('release:' + id),
      draw: (item: { id: string }) => events.push('draw:' + item.id),
      dispose: () => events.push('dispose'),
    }
    let release!: (m: unknown) => void
    restore = __setFeatureLoadersForTests({ generators: () => new Promise((r) => (release = r)) } as never)
    const onReady = vi.fn()
    const layer = new LazyLayer<{ id: string }, 'generators'>('generators', () => real as never, onReady)

    layer.acquire({ id: 'a' }, ctx)
    layer.acquire({ id: 'b' }, ctx)
    layer.release('b')
    layer.draw({ id: 'a' }, ctx) // nothing drawn, nothing thrown
    expect(events).toEqual([])
    release({})
    await new Promise((r) => setTimeout(r, 0))
    expect(events).toEqual(['acquire:a'])
    expect(onReady).toHaveBeenCalledTimes(1)
    layer.draw({ id: 'a' }, ctx)
    layer.release('a')
    layer.dispose()
    expect(events).toEqual(['acquire:a', 'draw:a', 'release:a', 'dispose'])
  })

  it('never loads for a scene that has no items, and logs a failed load once', async () => {
    const loader = vi.fn(async () => {
      throw new Error('boom')
    })
    restore = __setFeatureLoadersForTests({ rotoMasks: loader } as never)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const layer = new LazyLayer<{ id: string }, 'rotoMasks'>('rotoMasks', () => ({}) as never, () => {})
    layer.dispose()
    expect(loader).not.toHaveBeenCalled()

    const layer2 = new LazyLayer<{ id: string }, 'rotoMasks'>('rotoMasks', () => ({}) as never, () => {})
    layer2.acquire({ id: 'x' }, ctx)
    layer2.draw({ id: 'x' }, ctx)
    layer2.draw({ id: 'x' }, ctx)
    await new Promise((r) => setTimeout(r, 0))
    expect(err).toHaveBeenCalledTimes(1)
    expect(loader).toHaveBeenCalledTimes(1)
  })
})

describe('LazyEffectChain', () => {
  let restore: (() => void) | null = null
  afterEach(() => {
    restore?.()
    restore = null
  })
  const ctx = { gl: {} } as unknown as LayerContext

  it('reads as "no chain" until the effects feature loads, then forwards to one EffectChain', async () => {
    const draw = vi.fn(() => true)
    class FakeChain {
      draw = draw
      renderMatte = vi.fn(() => true)
      endFrame = vi.fn()
      drawTransition = vi.fn(() => true)
      renderTarget = vi.fn(() => null)
      releaseTargets = vi.fn()
      pool = { liveCount: 3 }
      notifyContextLost = vi.fn()
      dispose = vi.fn()
    }
    let release!: (m: unknown) => void
    restore = __setFeatureLoadersForTests({ effects: () => new Promise((r) => (release = r)) } as never)
    const ready = vi.fn()
    const chain = new LazyEffectChain(ready)

    // Unloaded: draw says "not drawn" (the layer draws plainly), optional methods are absent.
    expect(chain.draw(ctx, {} as never)).toBe(false)
    expect(chain.renderMatte).toBeUndefined()
    expect(chain.renderTarget).toBeUndefined()
    expect(chain.releaseTargets).toBeUndefined()
    expect(chain.drawTransition).toBeUndefined()
    expect(chain.endFrame).toBeUndefined()
    expect(chain.liveCount).toBe(0)

    release({ EffectChain: FakeChain })
    await new Promise((r) => setTimeout(r, 0))
    expect(ready).toHaveBeenCalledTimes(1)

    expect(chain.draw(ctx, {} as never)).toBe(true)
    expect(draw).toHaveBeenCalledTimes(1)
    expect(chain.renderMatte).toBeTypeOf('function')
    expect(chain.endFrame).toBeTypeOf('function')
    expect(chain.liveCount).toBe(3)
    chain.dispose()
    expect(chain.draw(ctx, {} as never)).toBe(false)
  })

  it('does not start a second load while one is in flight', async () => {
    const loader = vi.fn(() => new Promise(() => {}))
    restore = __setFeatureLoadersForTests({ effects: loader } as never)
    const chain = new LazyEffectChain(() => {})
    chain.draw(ctx, {} as never)
    void chain.renderTarget
    void chain.renderMatte
    expect(loader).toHaveBeenCalledTimes(1)
  })
})
