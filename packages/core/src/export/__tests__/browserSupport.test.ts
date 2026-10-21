import { describe, expect, it } from 'vitest'
import { detectExportSupport, EXPORT_UNSUPPORTED_MESSAGE } from '../browserSupport'

class GoodCanvas {
  getContext(id: string) {
    return id === 'webgl2' ? {} : null
  }
}
class NoGlCanvas {
  getContext() {
    return null
  }
}
class ThrowingCanvas {
  getContext(): never {
    throw new Error('no gl')
  }
}

const full = (): Record<string, unknown> => ({
  VideoEncoder: class {},
  VideoDecoder: class {},
  OffscreenCanvas: GoodCanvas,
  Worker: class {},
})

describe('detectExportSupport', () => {
  it('is ok with every feature present', () => {
    expect(detectExportSupport(full())).toEqual({ ok: true, missing: [], message: '' })
  })

  for (const key of ['VideoEncoder', 'VideoDecoder', 'Worker'] as const) {
    it(`reports missing ${key}`, () => {
      const env = full()
      delete env[key]
      const r = detectExportSupport(env)
      expect(r.ok).toBe(false)
      expect(r.missing).toEqual([key])
    })
  }

  it('reports missing OffscreenCanvas without also claiming WebGL2', () => {
    const env = full()
    delete env.OffscreenCanvas
    expect(detectExportSupport(env).missing).toEqual(['OffscreenCanvas'])
  })

  it('reports WebGL2 when the offscreen context is null', () => {
    expect(detectExportSupport({ ...full(), OffscreenCanvas: NoGlCanvas }).missing).toEqual(['WebGL2'])
  })

  it('reports WebGL2 when context creation throws', () => {
    expect(detectExportSupport({ ...full(), OffscreenCanvas: ThrowingCanvas }).missing).toEqual(['WebGL2'])
  })

  it('lists several missing features and names Chrome/Edge supported, Safari/Firefox untested', () => {
    const r = detectExportSupport({})
    expect(r.missing).toEqual(['VideoEncoder', 'VideoDecoder', 'OffscreenCanvas', 'Worker'])
    expect(r.message).toContain(EXPORT_UNSUPPORTED_MESSAGE)
    expect(r.message).toMatch(/Chrome and Edge/)
    expect(r.message).toMatch(/Safari and Firefox are untested/)
  })
})
