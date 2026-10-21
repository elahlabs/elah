/**
 * VideoLayer applies the clip's source rotation: content size is the DISPLAY
 * size, the quad lands where an upright picture would, and the shader receives
 * uRotation. Stage is portrait (1080x1920), source is an iPhone-style landscape
 * 1920x1080 frame with rotation metadata.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveVideoClip } from '../../../resolver/scene'
import type { LayerContext } from '../layers/types'
import { TexturePool } from '../TexturePool'
import type { VideoFrameProvider } from '../../../media/video'
import { displayToSourceUv, type VideoRotation } from '../../../media/video/rotation'
import { VideoLayer } from '../layers/VideoLayer'
import { videoUploadProbe } from '../layers/videoUploadProbe'

const __dirname = dirname(fileURLToPath(import.meta.url))

function createGL() {
  const calls = { uniform1i: [] as Array<[string, number]>, matrix: [] as Float32Array[] }
  const gl = {
    TEXTURE_2D: 0x0de1, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, NEAREST: 0x2600, LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f, TEXTURE0: 0x84c0, TRIANGLE_STRIP: 5, VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30, COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
    createTexture: vi.fn(() => ({})), deleteTexture: vi.fn(), bindTexture: vi.fn(),
    texParameteri: vi.fn(), texImage2D: vi.fn(),
    createVertexArray: vi.fn(() => ({})), deleteVertexArray: vi.fn(), bindVertexArray: vi.fn(),
    createProgram: vi.fn(() => ({})), deleteProgram: vi.fn(), createShader: vi.fn(() => ({})),
    deleteShader: vi.fn(), attachShader: vi.fn(), detachShader: vi.fn(), linkProgram: vi.fn(),
    compileShader: vi.fn(), shaderSource: vi.fn(), useProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true), getShaderParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ''), getShaderInfoLog: vi.fn(() => ''),
    getUniformLocation: vi.fn((_p: unknown, name: string) => ({ name })),
    uniform1i: vi.fn((loc: { name: string }, v: number) => calls.uniform1i.push([loc.name, v])),
    uniform1f: vi.fn(), uniform2f: vi.fn(), uniform4f: vi.fn(),
    uniformMatrix3fv: vi.fn((_l: unknown, _t: boolean, m: Float32Array) => calls.matrix.push(m)),
    activeTexture: vi.fn(), drawArrays: vi.fn(),
  }
  return { gl: gl as unknown as WebGL2RenderingContext, calls }
}

function frame(w: number, h: number): VideoFrame {
  return { close: vi.fn(), displayWidth: w, displayHeight: h, clone: vi.fn() } as unknown as VideoFrame
}

function clip(extra: Partial<ActiveVideoClip> = {}): ActiveVideoClip {
  return {
    id: 'c', trackId: 't', name: 'c', type: 'video', src: 'v://x', sourceFrame: 0,
    opacity: 1, zIndex: 0, volume: 1, ...extra,
  } as ActiveVideoClip
}

const CENTRED = { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } }

/** Stage-pixel position of a unit-quad corner under the uploaded 3x3 matrix. */
function cornerPx(m: Float32Array, u: number, v: number, sw: number, sh: number) {
  const ndcX = m[0] * u + m[3] * v + m[6]
  const ndcY = m[1] * u + m[4] * v + m[7]
  return { x: ((ndcX + 1) / 2) * sw, y: ((ndcY + 1) / 2) * sh }
}

function setup(
  rotation: VideoRotation | undefined,
  c: ActiveVideoClip,
  opts: { bitmap?: [number, number]; sourceSize?: { width: number; height: number } } = {},
) {
  videoUploadProbe.forgetAll()
  const { gl, calls } = createGL()
  const [bw, bh] = opts.bitmap ?? [1920, 1080]
  const provider: VideoFrameProvider = {
    getCurrent: vi.fn(() => frame(bw, bh)),
    setPlayhead: vi.fn(), markIdle: vi.fn(), markActive: vi.fn(), dispose: vi.fn(),
    ...(rotation !== undefined ? { rotation } : {}),
    ...(opts.sourceSize ? { sourceSize: opts.sourceSize } : {}),
  }
  const layer = new VideoLayer(new TexturePool({ maxTextures: 4 }), () => provider)
  const ctx: LayerContext = {
    gl, frame: 0, stage: { width: 1080, height: 1920 }, viewport: { width: 1080, height: 1920 }, fps: 30,
  }
  layer.acquire(c, ctx)
  layer.draw(c, ctx)
  return { calls }
}

function lastRotationUniform(calls: { uniform1i: Array<[string, number]> }): number | undefined {
  return calls.uniform1i.filter(([n]) => n === 'uRotation').at(-1)?.[1]
}

describe('VideoLayer source rotation (portrait stage 1080x1920)', () => {
  beforeEach(() => videoUploadProbe.forgetAll())

  it('90: fits the DISPLAY size so the clip fills the portrait stage, uRotation=90', () => {
    const { calls } = setup(90, clip())
    const m = calls.matrix.at(-1)!
    const tl = cornerPx(m, 0, 0, 1080, 1920)
    const br = cornerPx(m, 1, 1, 1080, 1920)
    expect(tl.x).toBeCloseTo(0)
    expect(tl.y).toBeCloseTo(0)
    expect(br.x).toBeCloseTo(1080)
    expect(br.y).toBeCloseTo(1920)
    expect(lastRotationUniform(calls)).toBe(90)
  })

  it('without rotation the same landscape frame letterboxes in the portrait stage', () => {
    const { calls } = setup(undefined, clip())
    const m = calls.matrix.at(-1)!
    const tl = cornerPx(m, 0, 0, 1080, 1920)
    const br = cornerPx(m, 1, 1, 1080, 1920)
    expect(br.x - tl.x).toBeCloseTo(1080)
    expect(br.y - tl.y).toBeCloseTo(607.5)
    expect(lastRotationUniform(calls)).toBe(0)
  })

  it.each([90, 270] as VideoRotation[])('%i: content w/h swap (box is 1080x1920 at scale 1)', (rot) => {
    const { calls } = setup(rot, clip({ transform: CENTRED }))
    const m = calls.matrix.at(-1)!
    const tl = cornerPx(m, 0, 0, 1080, 1920)
    const br = cornerPx(m, 1, 1, 1080, 1920)
    expect(br.x - tl.x).toBeCloseTo(1080)
    expect(br.y - tl.y).toBeCloseTo(1920)
    expect(lastRotationUniform(calls)).toBe(rot)
  })

  it('180: size unchanged (1920x1080 box), uRotation=180', () => {
    const { calls } = setup(180, clip({ transform: CENTRED }))
    const m = calls.matrix.at(-1)!
    const tl = cornerPx(m, 0, 0, 1080, 1920)
    const br = cornerPx(m, 1, 1, 1080, 1920)
    expect(br.x - tl.x).toBeCloseTo(1920)
    expect(br.y - tl.y).toBeCloseTo(1080)
    expect(lastRotationUniform(calls)).toBe(180)
  })

  it('stage top-left of an upright 90 picture samples the raw bottom-left', () => {
    const { calls } = setup(90, clip())
    const tl = cornerPx(calls.matrix.at(-1)!, 0, 0, 1080, 1920)
    expect([Math.round(tl.x), Math.round(tl.y)]).toEqual([0, 0])
    // quad.vert samples displayToSourceUv(90, u, v) for quad corner (u, v).
    expect(displayToSourceUv(90, 0, 0)).toEqual({ x: 0, y: 1 })
  })

  it('crop operates in display space', () => {
    const { calls } = setup(90, clip({ crop: { x: 0, y: 0, width: 1, height: 0.5 } }))
    const m = calls.matrix.at(-1)!
    // Display 1080x1920 cropped to its top half = 1080x960, contained in the stage.
    const tl = cornerPx(m, 0, 0, 1080, 1920)
    const br = cornerPx(m, 1, 1, 1080, 1920)
    expect(br.x - tl.x).toBeCloseTo(1080)
    expect(br.y - tl.y).toBeCloseTo(960)
  })
})

describe('downscaled bitmaps keep the source content size', () => {
  it('a 1080p bitmap of a 4K source draws into the same rect as the 4K bitmap (scale 1)', () => {
    // Stage 1080x1920 in setup(); scale-1 centred box = content size, so a
    // content size taken from the shrunken bitmap would change the rect.
    const full = setup(0, clip({ transform: CENTRED }), { bitmap: [3840, 2160] })
    const small = setup(0, clip({ transform: CENTRED }), {
      bitmap: [1920, 1080],
      sourceSize: { width: 3840, height: 2160 },
    })
    const mf = full.calls.matrix.at(-1)!
    const ms = small.calls.matrix.at(-1)!
    for (let i = 0; i < 9; i++) expect(ms[i]).toBeCloseTo(mf[i])
  })

  it('rotated 90: display size comes from sourceSize, not the bitmap', () => {
    const { calls } = setup(90, clip({ transform: CENTRED }), {
      bitmap: [640, 360],
      sourceSize: { width: 1920, height: 1080 },
    })
    const tl = cornerPx(calls.matrix.at(-1)!, 0, 0, 1080, 1920)
    const br = cornerPx(calls.matrix.at(-1)!, 1, 1, 1080, 1920)
    expect(br.x - tl.x).toBeCloseTo(1080)
    expect(br.y - tl.y).toBeCloseTo(1920)
  })
})

describe('quad.vert mirrors displayToSourceUv', () => {
  it('has a uRotation branch per quarter turn matching the TS mapping', () => {
    const src = readFileSync(join(__dirname, '../shaders/quad.vert.ts'), 'utf8')
    expect(src).toContain('uniform int uRotation;')
    expect(src).toContain('if (uRotation == 90) s = vec2(d.y, 1.0 - d.x);')
    expect(src).toContain('else if (uRotation == 180) s = vec2(1.0 - d.x, 1.0 - d.y);')
    expect(src).toContain('else if (uRotation == 270) s = vec2(1.0 - d.y, d.x);')
    expect(src).toContain('vTexCoord = vec2(s.x, 1.0 - s.y);')
  })
})

describe('export agrees with preview', () => {
  it('ExportWorker builds its CanvasSink without overriding the container rotation', () => {
    const src = readFileSync(join(__dirname, '../../../export/ExportWorker.ts'), 'utf8')
    expect(src).toContain('new mb.CanvasSink(track)')
    expect(src).not.toMatch(/CanvasSink\(track,\s*\{[^}]*rotation/)
  })
})
