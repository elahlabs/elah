import { describe, expect, it, vi } from 'vitest'
import { TimelineEngine } from '../../editor/TimelineEngine'
import { createEffect } from '../../effects/registry'
import { RecordingGl } from '../../renderer/gpu/debug/RecordingGl'
import { ExportCapabilityError, WorkerEffectRenderer, projectNeedsGpu } from '../gpuExport'

function projectWith(effects?: Parameters<TimelineEngine['updateClip']>[2]['effects']) {
  const engine = new TimelineEngine({ fps: 30 })
  const track = engine.addTrack('elements').id
  const clip = engine.addClip({ trackId: track, type: 'text', name: 't', text: { content: 'x' }, startFrame: 0, durationFrames: 30 })
  if (effects) engine.updateClip(clip.id, track, { effects })
  return engine.getProject()
}

const recordingFactory = () => {
  const gl = new RecordingGl()
  return { canvas: { width: 640, height: 360 } as unknown as OffscreenCanvas, gl: gl as unknown as WebGL2RenderingContext, recording: gl }
}

describe('projectNeedsGpu', () => {
  it('is false without effects, disabled effects or unknown kinds', () => {
    expect(projectNeedsGpu(projectWith())).toBe(false)
    expect(projectNeedsGpu(projectWith([{ ...createEffect('vignette'), enabled: false }]))).toBe(false)
    expect(projectNeedsGpu(projectWith([{ id: 'x', kind: 'from-the-future', params: {} }]))).toBe(false)
  })

  it('is true with one enabled, known effect', () => {
    expect(projectNeedsGpu(projectWith([createEffect('grain')]))).toBe(true)
  })
})

describe('projectNeedsGpu — compound nesting (PV-P1b-1)', () => {
  // `engine.getProject()` hands back a DEEPLY FROZEN project, so these builders
  // return new objects rather than mutating — which is also the honest shape
  // for a pure predicate.
  type P = ReturnType<typeof projectWith>

  /**
   * The track that actually holds a clip.
   *
   * NOT `Object.keys(clips)[0]`: a fresh TimelineEngine has a `video` track as
   * well as `elements`, the video one is empty, and index 0 is whichever came
   * first. Reading `clips[thatKey][0]` is then `undefined`, which spreads to
   * `{}` and produces a fixture that passes for the wrong reason.
   */
  function clipTrackId(project: P): string {
    const found = Object.entries(project.clips).find(([, clips]) => clips.length > 0)
    if (!found) throw new Error('no track holds a clip')
    return found[0]
  }

  function withClips(project: P, clips: P['clips']): P {
    return { ...project, clips }
  }

  /** The one clip of `project`, replaced. */
  function replaceClip(project: P, clip: P['clips'][string][0]): P {
    const trackId = clipTrackId(project)
    return withClips(project, { ...project.clips, [trackId]: [clip] })
  }

  function withMask(project: P): P {
    const trackId = clipTrackId(project)
    // A rect mask needs real bounds to be drawable; `isDrawableMask` is what
    // projectNeedsGpu asks, so the shape has to satisfy it.
    return replaceClip(project, { ...project.clips[trackId][0], mask: { kind: 'rect', x: 0.1, y: 0.1, width: 0.5, height: 0.5 } })
  }

  function withTransition(project: P, kind: string): P {
    const from = project.clips[clipTrackId(project)][0].id
    return {
      ...project,
      transitions: [
        { id: 'tr1', fromClipId: from, toClipId: from, kind, startFrame: 0, durationFrames: 10, easing: 'linear' },
      ] as unknown as P['transitions'],
    }
  }

  /** Wrap `child` as the single clip of a fresh parent project. */
  function wrap(child: P, id: string): P {
    const parent = projectWith()
    const trackId = clipTrackId(parent)
    return replaceClip(parent, {
      ...parent.clips[trackId][0],
      id,
      type: 'compound',
      compound: { project: child },
      effects: undefined,
      mask: undefined,
      matte: undefined,
    })
  }

  /** `levels` nested compounds, with `innermost` as the deepest project. */
  function nest(levels: number, innermost: P): P {
    let project = innermost
    for (let i = 0; i < levels; i++) project = wrap(project, `c${i}`)
    return project
  }

  it('finds a GPU effect on a child of a compound', () => {
    // The regression this exists for: the effect is invisible to a flat walk of
    // project.clips, so the export would drop it and still look successful.
    expect(projectNeedsGpu(wrap(projectWith([createEffect('grain')]), 'c0'))).toBe(true)
  })

  it('finds a GPU effect two compounds down', () => {
    expect(projectNeedsGpu(nest(2, projectWith([createEffect('grain')])))).toBe(true)
  })

  it('finds a drawable mask on a child', () => {
    expect(projectNeedsGpu(wrap(withMask(projectWith()), 'c0'))).toBe(true)
  })

  it('finds a GPU-only transition inside a nested project', () => {
    // `zoom` is canvas2d:false, so the nested transition needs the GPU. Each
    // level carries its own transitions and the walk checks them on the way in.
    expect(projectNeedsGpu(wrap(withTransition(projectWith(), 'zoom'), 'c0'))).toBe(true)
  })

  it('is false for a Canvas2D-capable transition inside a nested project', () => {
    expect(projectNeedsGpu(wrap(withTransition(projectWith(), 'fade'), 'c0'))).toBe(false)
  })

  it('is false for a compound of plain children', () => {
    expect(projectNeedsGpu(wrap(projectWith(), 'c0'))).toBe(false)
  })

  it('descends to the deepest level the resolver materialises, and no further', () => {
    // The resolver collects compounds at depths 0..3 and resolves their children
    // at 1..4, so a masked clip at depth 4 is real and must be found. One more
    // level is never materialised, so it is not consulted — returning true there
    // would demand a GPU for a frame that is never drawn.
    const masked = withMask(projectWith())
    expect(projectNeedsGpu(nest(4, masked))).toBe(true)
    expect(projectNeedsGpu(nest(5, masked))).toBe(false)
  })
})

describe('WorkerEffectRenderer', () => {
  it('reports a capability error when there is no WebGL2', () => {
    expect(() => WorkerEffectRenderer.create({ width: 640, height: 360 }, { width: 1920, height: 1080 }, 30, () => null)).toThrow(
      ExportCapabilityError,
    )
    expect(() =>
      WorkerEffectRenderer.create({ width: 640, height: 360 }, { width: 1920, height: 1080 }, 30, () => {
        throw new Error('context creation failed')
      }),
    ).toThrow(/WebGL2/)
  })

  it('draws a clip through the effect chain onto a cleared, transparent frame', () => {
    const made = recordingFactory()
    const clear = vi.spyOn(made.recording, 'clearColor')
    const renderer = WorkerEffectRenderer.create({ width: 640, height: 360 }, { width: 1920, height: 1080 }, 30, () => made)
    const source = { width: 1920, height: 1080 } as unknown as TexImageSource & { width: number; height: number }
    const effect = createEffect('colorGrade', 'noir')
    const out = renderer.draw(
      { source, opacity: 0.8, effects: [{ id: effect.id, kind: effect.kind, params: effect.params }] },
      0,
    )
    expect(out).toBe(made.canvas)
    expect(renderer.runs).toBe(1)
    expect(clear).toHaveBeenCalledWith(0, 0, 0, 0)
  })

  it('uploads an ImageBitmap through a canvas copy, so FLIP_Y applies (EDX-P9 fix)', () => {
    // WebGL ignores UNPACK_FLIP_Y for ImageBitmaps; the preview's <img> and
    // every canvas source are flipped, so a raw bitmap came out upside down.
    class FakeBitmap {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
    }
    const drawn: unknown[] = []
    class FakeCanvas {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext() {
        return { drawImage: (src: unknown) => drawn.push(src) }
      }
    }
    vi.stubGlobal('ImageBitmap', FakeBitmap)
    vi.stubGlobal('OffscreenCanvas', FakeCanvas)
    try {
      const made = recordingFactory()
      const upload = vi.spyOn(made.recording, 'texImage2D')
      const renderer = WorkerEffectRenderer.create({ width: 640, height: 360 }, { width: 1920, height: 1080 }, 30, () => made)
      const bitmap = new FakeBitmap(800, 450) as unknown as TexImageSource & { width: number; height: number }
      const effect = createEffect('vignette')
      renderer.draw({ source: bitmap, opacity: 1, effects: [{ id: effect.id, kind: effect.kind, params: effect.params }] }, 0)
      renderer.draw({ source: bitmap, opacity: 1, effects: [{ id: effect.id, kind: effect.kind, params: effect.params }] }, 1)
      const uploaded = upload.mock.calls.map((c) => c[5]).filter((s) => s instanceof FakeCanvas || s === bitmap)
      expect(uploaded.length).toBeGreaterThan(0)
      expect(uploaded.every((s) => s instanceof FakeCanvas)).toBe(true)
      // One copy per bitmap, reused across frames.
      expect(drawn).toEqual([bitmap])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns null (draw it the 2D way) when nothing can run', () => {
    const made = recordingFactory()
    const renderer = WorkerEffectRenderer.create({ width: 640, height: 360 }, { width: 1920, height: 1080 }, 30, () => made)
    const source = { width: 100, height: 100 } as unknown as TexImageSource & { width: number; height: number }
    expect(renderer.draw({ source, opacity: 1, effects: [{ id: 'x', kind: 'nope', params: {} }] }, 0)).toBeNull()
  })

  it('the same frame always issues the same GL calls', async () => {
    const run = async () => {
      const made = recordingFactory()
      const renderer = WorkerEffectRenderer.create({ width: 640, height: 360 }, { width: 1920, height: 1080 }, 30, () => made)
      made.recording.reset()
      const source = { width: 1280, height: 720 } as unknown as TexImageSource & { width: number; height: number }
      const blur = createEffect('gaussianBlur')
      renderer.draw({ source, opacity: 1, cornerRadius: 0.1, effects: [{ id: 'b', kind: blur.kind, params: blur.params }] }, 12)
      return made.recording.digest()
    }
    expect(await run()).toBe(await run())
  })
})

describe('WorkerEffectRenderer — drawing inside a compound (EXP-1)', () => {
  const OUT = { width: 640, height: 360 }
  const STAGE = { width: 1920, height: 1080 }
  const grain = createEffect('grain')
  const effects = [{ id: grain.id, kind: grain.kind, params: grain.params }]

  function open() {
    const made = recordingFactory()
    const renderer = WorkerEffectRenderer.create(OUT, STAGE, 30, () => made)
    made.recording.reset()
    return { made, renderer }
  }

  const source = { width: 400, height: 200 } as unknown as TexImageSource & { width: number; height: number }

  it('measures the draw in the view stage, not the project stage', async () => {
    const digest = (view?: { stage: { width: number; height: number } }) => {
      const { made, renderer } = open()
      renderer.draw({ source, opacity: 1, effects, transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } } }, 0, view)
      return made.recording.digest()
    }
    const root = await digest()
    expect(await digest({ stage: STAGE })).toBe(root)
    expect(await digest({ stage: { width: 400, height: 200 } })).not.toBe(root)
  })

  it('places by the content size when the source is a capped copy of it', async () => {
    const transform = { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } }
    const digest = (picture: { width: number; height: number }, contentSize?: { width: number; height: number }) => {
      const { made, renderer } = open()
      const src = picture as unknown as TexImageSource & { width: number; height: number }
      renderer.draw({ source: src, ...(contentSize ? { contentSize } : {}), opacity: 1, effects, transform }, 0)
      return made.recording.digest()
    }
    // A 200x100 picture standing for 400x200 content is placed like the
    // 400x200 one; without the content size it is placed by its own pixels.
    expect(await digest({ width: 200, height: 100 }, { width: 400, height: 200 })).toBe(await digest({ width: 400, height: 200 }))
    expect(await digest({ width: 200, height: 100 })).not.toBe(await digest({ width: 400, height: 200 }))
  })

  it('sizes the canvas to the view output for that draw and back to the frame after', () => {
    const { made, renderer } = open()
    const canvas = made.canvas as unknown as { width: number; height: number }
    renderer.draw({ source, opacity: 1, effects }, 0, { output: { width: 400, height: 200 } })
    expect([canvas.width, canvas.height]).toEqual([400, 200])
    renderer.draw({ source, opacity: 1, effects }, 0)
    expect([canvas.width, canvas.height]).toEqual([640, 360])
  })

  it('reads a matte under the key prefix it was set with', () => {
    const { renderer } = open()
    const matte = { sourceClipId: 'E', kind: 'alpha' as const, invert: false }
    const matteSource = { width: 8, height: 8 } as unknown as TexImageSource
    expect(renderer.setMatte('E', matteSource, 'C/')).toBe(true)
    // Found under C/: the chain runs.
    renderer.draw({ source, opacity: 1, effects, matte }, 0, { keyPrefix: 'C/' })
    expect(renderer.runs).toBe(1)
    // Not found at the root: an empty matte hides the clip, no chain run.
    renderer.draw({ source, opacity: 1, effects, matte }, 0)
    expect(renderer.runs).toBe(1)
    // And released with its compound.
    renderer.releaseKeys('C/')
    renderer.draw({ source, opacity: 1, effects, matte }, 0, { keyPrefix: 'C/' })
    expect(renderer.runs).toBe(1)
  })
})
