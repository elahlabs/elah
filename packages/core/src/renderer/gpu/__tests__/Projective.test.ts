/**
 * Projective (MOT-8 phase B) - rotateX / rotateY with perspective agree across the paths that draw
 * a tilted clip.
 *
 *   GPU quad (preview image / video / sequence / compound)   buildTransformMatrixFromRect (mat3 with w)
 *   export (same four kinds)                                  WorkerEffectRenderer -> the same shader + matrix
 *   selection overlay (editor package)                        CSS perspective() rotateX() rotateY() rotate() skew()
 *
 * The reference is the CSS transform chain done with explicit 4x4 matrices (translate to the box
 * centre, perspective(d), rotateX, rotateY, rotate, skew, translate back), deliberately not the
 * code under test. Corners are compared on 1920x1080 and 1080x1920. Text, shape and freehand clips
 * paint to a 2D canvas and ignore the tilt (documented in gpuExport.ts), so there is nothing to
 * agree on for them; the last block pins that.
 *
 * Backface: no culling. Past 90 degrees the clip shows its back face, MIRRORED (what CSS
 * backface-visibility: visible does); the signed area of the projected quad flips sign.
 */

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildDrawTransformMatrix,
  buildTransformMatrixFromRect,
  projectTiltedPoint,
  rectTilt,
  resolveDrawRect,
  tiltFields,
  tiltOf,
  DEFAULT_PERSPECTIVE,
  type DrawRect,
} from '../layers/drawRect'
import { QUAD_VERT_SRC } from '../shaders/quad.vert'
import { RecordingGl } from '../debug/RecordingGl'
import { WorkerEffectRenderer, projectNeedsGpu } from '../../../export/gpuExport'
import { TimelineEngine } from '../../../editor/TimelineEngine'
import { resolveTimeline } from '../../../resolver/resolveTimeline'
import { setKeyframe } from '../../../elements/keyframes'
import type { Transform } from '../../../types'

const LANDSCAPE = { width: 1920, height: 1080 }
const PORTRAIT = { width: 1080, height: 1920 }
const STAGES = [LANDSCAPE, PORTRAIT]
const deg = (d: number) => (d * Math.PI) / 180
const CONTENT = { width: 640, height: 360 }

type Pt = { x: number; y: number }
type M4 = number[][]

function transform(over: Partial<Transform> = {}): Transform {
  return { x: 0.45, y: 0.55, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 }, ...over }
}

// --- the independent reference: CSS matrices ------------------------------------------------------

const I4 = (): M4 => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
function mul4(a: M4, b: M4): M4 {
  const o = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r][c] += a[r][k] * b[k][c]
  return o
}
const translate4 = (x: number, y: number): M4 => { const m = I4(); m[0][3] = x; m[1][3] = y; return m }
const perspective4 = (d: number): M4 => { const m = I4(); m[3][2] = -1 / d; return m }
const rotX4 = (a: number): M4 => { const m = I4(); m[1][1] = Math.cos(a); m[1][2] = -Math.sin(a); m[2][1] = Math.sin(a); m[2][2] = Math.cos(a); return m }
const rotY4 = (a: number): M4 => { const m = I4(); m[0][0] = Math.cos(a); m[0][2] = Math.sin(a); m[2][0] = -Math.sin(a); m[2][2] = Math.cos(a); return m }
const rotZ4 = (a: number): M4 => { const m = I4(); m[0][0] = Math.cos(a); m[0][1] = -Math.sin(a); m[1][0] = Math.sin(a); m[1][1] = Math.cos(a); return m }
const skew4 = (ax: number, ay: number): M4 => { const m = I4(); m[0][1] = Math.tan(ax); m[1][0] = Math.tan(ay); return m }

/** Clamp the angle the way the engine does (wrap, nudge off edge-on) so the reference sees the same input. */
const safe = (a: number | undefined) => tiltOf(a, 0)?.ax ?? tiltOf(0, a)?.ay ?? 0

/** The four corners (TL, TR, BL, BR) of a clip's box under the CSS chain, in stage px. */
function cssCorners(t: Transform, stage: { width: number; height: number }): Pt[] {
  const rect = resolveDrawRect(t, stage.width, stage.height, CONTENT.width, CONTENT.height)
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const d = t.perspective ?? DEFAULT_PERSPECTIVE
  let m = translate4(cx, cy)
  m = mul4(m, perspective4(d))
  m = mul4(m, rotX4(safe(t.rotateX)))
  m = mul4(m, rotY4(safe(t.rotateY)))
  m = mul4(m, rotZ4(t.rotation))
  m = mul4(m, skew4(Math.min(Math.abs(t.skewX ?? 0), deg(89)) * Math.sign(t.skewX ?? 0), Math.min(Math.abs(t.skewY ?? 0), deg(89)) * Math.sign(t.skewY ?? 0)))
  return [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => {
    const x = (u - 0.5) * rect.width
    const y = (v - 0.5) * rect.height
    const X = m[0][0] * x + m[0][1] * y + m[0][3]
    const Y = m[1][0] * x + m[1][1] * y + m[1][3]
    const W = m[3][0] * x + m[3][1] * y + m[3][3]
    return { x: X / W, y: Y / W }
  })
}

/** What the vertex shader does with the uploaded matrix: gl_Position = (x, -y, 0, w), then the viewport. */
function shaderCorners(m: Float32Array, stage: { width: number; height: number }): Pt[] {
  return [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => {
    const x = m[0] * u + m[3] * v + m[6]
    const y = m[1] * u + m[4] * v + m[7]
    const w = m[2] * u + m[5] * v + m[8]
    return { x: ((x / w + 1) / 2) * stage.width, y: ((y / w + 1) / 2) * stage.height }
  })
}

function maxDist(a: Pt[], b: Pt[]): number {
  return Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)))
}

function area(c: Pt[]): number {
  // TL, TR, BR, BL order
  const p = [c[0], c[1], c[3], c[2]]
  let s = 0
  for (let i = 0; i < 4; i++) {
    const a = p[i]
    const b = p[(i + 1) % 4]
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

const CASES: Array<{ name: string; t: Partial<Transform> }> = [
  { name: 'rotateY 50deg', t: { rotateY: deg(50) } },
  { name: 'rotateX 35deg', t: { rotateX: deg(35) } },
  { name: 'rotateX + rotateY', t: { rotateX: deg(-25), rotateY: deg(40) } },
  { name: 'rotateY + rotation 30deg', t: { rotateY: deg(55), rotation: deg(30) } },
  { name: 'rotateX + skewX 12deg', t: { rotateX: deg(30), skewX: deg(12) } },
  { name: 'rotateY + skew + rotation', t: { rotateY: deg(60), skewX: deg(12), skewY: deg(-6), rotation: deg(-40) } },
  { name: 'rotateY + scale + scaleX/scaleY', t: { rotateY: deg(45), scale: 0.6, scaleX: 1.6, scaleY: 0.7 } },
  { name: 'rotateX + off-centre anchor', t: { rotateX: deg(40), anchor: { x: 0.1, y: 0.9 } } },
  { name: 'rotateY with perspective 600', t: { rotateY: deg(35), perspective: 600 } },
  { name: 'rotateY past 90 (back face)', t: { rotateY: deg(125) } },
  { name: 'rotateX 200deg (wraps)', t: { rotateX: deg(200) } },
]

describe('projective matrix vs CSS reference (corners, within 0.05 px)', () => {
  for (const stage of STAGES) {
    for (const c of CASES) {
      it(`${stage.width}x${stage.height}: ${c.name}`, () => {
        const t = transform(c.t)
        const m = buildDrawTransformMatrix(t, stage.width, stage.height, CONTENT.width, CONTENT.height)
        expect(maxDist(shaderCorners(m, stage), cssCorners(t, stage))).toBeLessThan(0.05)
        // The pure function the overlay and the tests share agrees with the matrix too.
        const rect = resolveDrawRect(t, stage.width, stage.height, CONTENT.width, CONTENT.height)
        const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => projectTiltedPoint(rect, stage.width, stage.height, u, v)!)
        expect(maxDist(pts, cssCorners(t, stage))).toBeLessThan(1e-6)
      })
    }
  }
})

describe('every path that places a tilted clip uses the same matrix', () => {
  it('image, video, sequence and compound layers all go through buildDrawTransformMatrix', () => {
    const dir = new URL('../layers/', import.meta.url)
    for (const f of ['ImageLayer.ts', 'VideoLayer.ts', 'SequenceLayer.ts', 'CompoundLayer.ts']) {
      const src = readFileSync(new URL(f, dir), 'utf8')
      expect(src, f).toMatch(/buildDrawTransformMatrix|buildTransformMatrixFromRect|buildVideoTransformMatrix/)
      // None of them hand-rolls the affine pieces, so the third row cannot be dropped on the way.
      expect(src, f).not.toMatch(/new Float32Array\(\[/)
    }
  })

  it('the vertex shader uses the matrix third row as w', () => {
    expect(QUAD_VERT_SRC).toContain('gl_Position = vec4(ndc.x, -ndc.y, 0.0, ndc.z);')
  })

  it('clips with effects keep their tilt (EffectChain outRect)', () => {
    const src = readFileSync(new URL('../EffectChain.ts', import.meta.url), 'utf8')
    expect(src).toContain('rotateX: rect.rotateX')
    expect(src).toContain('rotateY: rect.rotateY')
    expect(src).toContain('perspective: rect.perspective')
  })
})

describe('zero 3D rotation is identical to today', () => {
  const flat = [
    transform(),
    transform({ rotation: deg(30) }),
    transform({ rotation: deg(-135), skewX: deg(15), skewY: deg(5), scaleX: 1.3 }),
    transform({ scale: 0.25, anchor: { x: 0, y: 0 } }),
  ]

  it('tiltFields is empty and the rect has no 3D keys when both angles are 0 or whole turns', () => {
    for (const t of [transform({ rotateX: 0, rotateY: 0 }), transform({ rotateX: 2 * Math.PI, rotateY: -4 * Math.PI }), transform({ perspective: 300 })]) {
      expect(tiltFields(t)).toEqual({})
      const rect = resolveDrawRect(t, 1920, 1080, 640, 360)
      expect('rotateX' in rect || 'rotateY' in rect || 'perspective' in rect).toBe(false)
      expect(rectTilt(rect)).toBeUndefined()
    }
  })

  it('the matrix is bit-identical with or without the zero fields, and its third row is (0, 0, 1)', () => {
    for (const stage of STAGES) {
      for (const t of flat) {
        const plain = buildDrawTransformMatrix(t, stage.width, stage.height, 640, 360)
        const zeroed = buildDrawTransformMatrix({ ...t, rotateX: 0, rotateY: 0, perspective: 900 }, stage.width, stage.height, 640, 360)
        expect(Array.from(zeroed)).toEqual(Array.from(plain))
        expect([plain[2], plain[5], plain[8]]).toEqual([0, 0, 1])
      }
    }
  })

  it('an unrotated, unskewed matrix is the original expression', () => {
    const rect: DrawRect = { x: 100, y: 50, width: 400, height: 300, rotation: 0 }
    const m = buildTransformMatrixFromRect(rect, 1920, 1080)
    const m00 = (2 * 400) / 1920
    const m11 = (2 * 300) / 1080
    expect(Array.from(m)).toEqual(Array.from(new Float32Array([m00, 0, 0, -0, m11, 0, (2 * 300) / 1920 - 1 - m00 / 2, (2 * 200) / 1080 - 1 - m11 / 2, 1])))
  })

  it('WorkerEffectRenderer draws a flat clip with nothing to do as null (the 2D way), as before', () => {
    const gl = new RecordingGl()
    const made = { canvas: { width: 640, height: 360 } as unknown as OffscreenCanvas, gl: gl as unknown as WebGL2RenderingContext }
    const renderer = WorkerEffectRenderer.create({ width: 640, height: 360 }, LANDSCAPE, 30, () => made)
    const source = { width: 640, height: 360 } as unknown as TexImageSource & { width: number; height: number }
    expect(renderer.draw({ source, opacity: 1, effects: [], transform: transform({ rotateY: 0 }) }, 0)).toBeNull()
  })
})

describe('card flip through and past 90 degrees', () => {
  const stage = LANDSCAPE
  const at = (rotateY: number) => {
    const t = transform({ rotateY })
    const m = buildDrawTransformMatrix(t, stage.width, stage.height, CONTENT.width, CONTENT.height)
    return shaderCorners(m, stage)
  }

  it('edge-on (exactly 90 degrees) is finite and nearly flat: no NaN, no infinity', () => {
    for (const a of [deg(90), deg(-90), deg(90) + 1e-9, deg(270)]) {
      const c = at(a)
      for (const p of c) {
        expect(Number.isFinite(p.x)).toBe(true)
        expect(Number.isFinite(p.y)).toBe(true)
      }
      // The projected width collapses to a sliver.
      const w = Math.abs(c[1].x - c[0].x)
      expect(w).toBeLessThan(0.01 * 640 * 1)
    }
  })

  it('front face keeps the flat winding, back face is mirrored (no culling)', () => {
    const flatArea = area(at(0))
    expect(flatArea).toBeGreaterThan(0)
    expect(area(at(deg(50)))).toBeGreaterThan(0)
    expect(area(at(deg(89.5)))).toBeGreaterThan(0)
    expect(area(at(deg(90.5)))).toBeLessThan(0)
    expect(area(at(deg(130)))).toBeLessThan(0)
    expect(area(at(deg(179)))).toBeLessThan(0)
    // A full half turn is the mirror image at (nearly) the flat size.
    expect(Math.abs(area(at(deg(180))))).toBeGreaterThan(0.9 * flatArea)
    expect(area(at(deg(180)))).toBeLessThan(0)
    expect(area(at(deg(360)))).toBeCloseTo(flatArea, 3)
  })

  it('the angle is continuous through 90: either side is within a sliver of the edge', () => {
    expect(Math.abs(area(at(deg(89.8))))).toBeLessThan(0.01 * Math.abs(area(at(0))))
    expect(Math.abs(area(at(deg(90.2))))).toBeLessThan(0.01 * Math.abs(area(at(0))))
  })

  it('a card wider than the eye distance reports w <= 0 on the near side (the GPU clips it)', () => {
    const t = transform({ rotateY: deg(70), perspective: 300, scale: 1 })
    const rect = resolveDrawRect(t, stage.width, stage.height, 1920, 1080)
    const ws = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => projectTiltedPoint(rect, stage.width, stage.height, u, v)!.w)
    expect(Math.min(...ws)).toBeLessThanOrEqual(0)
    expect(Math.max(...ws)).toBeGreaterThan(0)
  })
})

describe('export: a tilted clip is drawn by the worker WebGL2 renderer with the preview matrix', () => {
  const OUT = { width: 640, height: 360 }
  const source = { width: 640, height: 360 } as unknown as TexImageSource & { width: number; height: number }

  function open() {
    const gl = new RecordingGl()
    const made = { canvas: { width: OUT.width, height: OUT.height } as unknown as OffscreenCanvas, gl: gl as unknown as WebGL2RenderingContext }
    const renderer = WorkerEffectRenderer.create(OUT, LANDSCAPE, 30, () => made)
    return { made, gl, renderer }
  }

  for (const c of CASES.slice(0, 6)) {
    it(`uploads the same mat3 and draws one quad: ${c.name}`, () => {
      const { made, gl, renderer } = open()
      const spy = vi.spyOn(gl, 'uniformMatrix3fv')
      const draw = vi.spyOn(gl, 'drawArrays')
      const t = transform(c.t)
      const out = renderer.draw({ source, opacity: 0.7, effects: [], transform: t }, 0)
      expect(out).toBe(made.canvas)
      const mats = spy.mock.calls.map((a) => a[2] as Float32Array)
      expect(mats.length).toBe(1)
      const want = buildDrawTransformMatrix(t, LANDSCAPE.width, LANDSCAPE.height, source.width, source.height)
      expect(Array.from(mats[0])).toEqual(Array.from(want))
      expect(draw).toHaveBeenCalledTimes(1)
      // And those uploaded corners are the CSS reference's.
      expect(maxDist(shaderCorners(mats[0], LANDSCAPE), cssCorners(t, LANDSCAPE))).toBeLessThan(0.05)
    })
  }

  it('a tilted clip with an effect still goes through the chain, with its tilt on the placement', () => {
    const { gl, renderer } = open()
    const spy = vi.spyOn(gl, 'uniformMatrix3fv')
    renderer.draw({ source, opacity: 1, effects: [{ id: 'v', kind: 'vignette', params: {} }], transform: transform({ rotateY: deg(40) }) }, 0)
    const mats = spy.mock.calls.map((a) => a[2] as Float32Array)
    // At least one uploaded matrix has a perspective row (the final placement).
    expect(mats.some((m) => m[2] !== 0 || m[5] !== 0)).toBe(true)
  })
})

describe('projectNeedsGpu and kinds', () => {
  function project(type: 'image' | 'text', t?: Partial<Transform>, keyed?: 'rotateX' | 'rotateY') {
    const engine = new TimelineEngine({ fps: 30, stage: LANDSCAPE })
    const track = engine.addTrack('elements').id
    const clip =
      type === 'image'
        ? engine.addClip({ trackId: track, type: 'image', name: 'I', src: 'x.png', startFrame: 0, durationFrames: 60, ...(t ? { transform: transform(t) } : {}) } as never)
        : engine.addClip({ trackId: track, type: 'text', name: 'T', text: { content: 'x' }, startFrame: 0, durationFrames: 60, ...(t ? { transform: transform(t) } : {}) } as never)
    if (keyed) {
      const patch = setKeyframe(engine.findClip(clip.id)!.clip, keyed, 10, { stage: LANDSCAPE, content: CONTENT })
      engine.updateClip(clip.id, track, patch as never)
    }
    return engine.getProject()
  }

  it('a flat clip does not need the GPU; a tilted media clip does', () => {
    expect(projectNeedsGpu(project('image'))).toBe(false)
    expect(projectNeedsGpu(project('image', { rotateY: 0 }))).toBe(false)
    expect(projectNeedsGpu(project('image', { rotateY: deg(30) }))).toBe(true)
  })

  it('keys on rotateX / rotateY need it too', () => {
    expect(projectNeedsGpu(project('image', undefined, 'rotateX'))).toBe(true)
    expect(projectNeedsGpu(project('image', undefined, 'rotateY'))).toBe(true)
  })

  it('text ignores the tilt (refused kind): no GPU, no projective draw', () => {
    expect(projectNeedsGpu(project('text', { rotateY: deg(30) }))).toBe(false)
  })

  it('the channels resolve into the active clip transform and animate', () => {
    const engine = new TimelineEngine({ fps: 30, stage: LANDSCAPE })
    const track = engine.addTrack('elements').id
    const clip = engine.addClip({ trackId: track, type: 'image', name: 'I', src: 'x.png', startFrame: 0, durationFrames: 60, transform: transform({ perspective: 700 }) } as never)
    let patch = setKeyframe(engine.findClip(clip.id)!.clip, 'rotateY', 0, { stage: LANDSCAPE, content: CONTENT })
    engine.updateClip(clip.id, track, patch as never)
    patch = setKeyframe(engine.findClip(clip.id)!.clip, 'rotateY', 30, { stage: LANDSCAPE, content: CONTENT }, deg(90))
    engine.updateClip(clip.id, track, patch as never)
    const item = resolveTimeline(15, engine.getProject()).images[0]!
    expect(item.transform?.rotateY ?? 0).toBeGreaterThan(0)
    expect(item.transform?.perspective).toBe(700)
  })
})
