import { describe, expect, it, vi } from 'vitest'
import { collectImageSrcs, preDecodeSvgImages, svgByUrl, SVG_FALLBACK_SIZE } from '../preDecode'
import type { Clip, Project, Track } from '../../types'

/**
 * PV-P6b-4: the main-thread half of SVG image export.
 *
 * `svgByUrl` and `collectImageSrcs` are pure. `preDecodeSvgImages` has every
 * DOM dependency injected, so this file runs under Node — none of it touches
 * `ExportWorker.ts`, which must stay DOM-free.
 */

const track = (id: string, order: number, over: Partial<Track> = {}): Track =>
  ({ id, kind: 'video', name: id, order, height: 54, locked: false, disabled: false, muted: false, solo: false, volume: 1, protected: false, ...over }) as Track

const clip = (id: string, trackId: string, over: Partial<Clip> = {}): Clip =>
  ({
    id,
    trackId,
    type: 'image',
    name: id,
    startFrame: 0,
    durationFrames: 60,
    opacity: 1,
    ...over,
  }) as Clip

function projectOf(tracks: Track[], clips: Clip[], over: Partial<Project> = {}): Project {
  const byTrack: Record<string, Clip[]> = {}
  for (const t of tracks) byTrack[t.id] = []
  for (const c of clips) (byTrack[c.trackId] ??= []).push(c)
  return { id: 'p', version: 4, fps: 30, stage: { width: 1280, height: 720 }, tracks, clips: byTrack, transitions: [], ...over } as Project
}

/** A fake ImageBitmap the tests can identify by reference and inspect. */
class FakeBitmap {
  closed = false
  constructor(public width: number, public height: number) {}
  close(): void {
    this.closed = true
  }
}

describe('svgByUrl', () => {
  it.each<[string, boolean | null]>([
    ['data:image/svg+xml;utf8,<svg/>', true],
    ['https://cdn/x/logo.SVG?v=2', true],
    ['https://cdn/a.png', false],
    ['data:image/png;base64,AA', false],
    ['blob:http://localhost/abc', null],
    ['https://cdn/asset/123', null],
  ])('%s -> %s', (src, expected) => {
    expect(svgByUrl(src)).toBe(expected)
  })
})

describe('collectImageSrcs', () => {
  it('lists unique image srcs, through a compound, in first-seen order', () => {
    const nested = projectOf(
      [track('nv', 0)],
      [clip('c-img1', 'nv', { src: 'c.svg' }), clip('c-img2', 'nv', { src: 'a.svg' })],
    )
    const compound = clip('comp1', 'v', {
      type: 'compound',
      src: undefined,
      compound: { project: nested },
    } as Partial<Clip>)
    const project = projectOf(
      [track('v', 0)],
      [
        clip('img-a', 'v', { src: 'a.svg' }),
        clip('img-b', 'v', { src: 'b.png' }),
        clip('text-1', 'v', { type: 'text', src: undefined } as Partial<Clip>),
        clip('img-nosrc', 'v', { src: undefined }),
        compound,
      ],
    )
    expect(collectImageSrcs(project)).toEqual(['a.svg', 'b.png', 'c.svg'])
  })
})

describe('preDecodeSvgImages', () => {
  it('rasterises only the SVG sources, resolved by URL or by content type', async () => {
    const project = projectOf(
      [track('v', 0)],
      [
        clip('a', 'v', { src: 'a.svg' }),
        clip('b', 'v', { src: 'b.png' }),
        clip('x', 'v', { src: 'blob:x' }),
        clip('y', 'v', { src: 'blob:y' }),
      ],
    )
    const contentType = vi.fn(async (src: string) => (src === 'blob:x' ? 'image/svg+xml' : 'image/png'))
    const loadImage = vi.fn(async (_src: string) => ({ source: {} as CanvasImageSource, width: 48, height: 24 }))
    const rasterize = vi.fn(async (_source: CanvasImageSource, w: number, h: number) => new FakeBitmap(w, h) as unknown as ImageBitmap)

    const out = await preDecodeSvgImages(project, undefined, { loadImage, rasterize, contentType })

    expect(Object.keys(out)).toEqual(['a.svg', 'blob:x'])
    expect(loadImage.mock.calls.map((c) => c[0])).toEqual(['a.svg', 'blob:x'])
    expect(rasterize).toHaveBeenCalledTimes(2)
    for (const call of rasterize.mock.calls) {
      expect(call[1]).toBe(48)
      expect(call[2]).toBe(24)
    }
  })

  it('keeps an existing entry and never calls loadImage for it', async () => {
    const project = projectOf([track('v', 0)], [clip('a', 'v', { src: 'a.svg' })])
    const existingBitmap = new FakeBitmap(10, 10) as unknown as ImageBitmap
    const loadImage = vi.fn(async () => ({ source: {} as CanvasImageSource, width: 48, height: 24 }))
    const rasterize = vi.fn(async (_s: CanvasImageSource, w: number, h: number) => new FakeBitmap(w, h) as unknown as ImageBitmap)

    const out = await preDecodeSvgImages(project, { 'a.svg': existingBitmap }, { loadImage, rasterize })

    expect(out['a.svg']).toBe(existingBitmap)
    expect(loadImage).not.toHaveBeenCalled()
    expect(rasterize).not.toHaveBeenCalled()
  })

  it('falls back to the 1024 square and warns when the natural size is 0', async () => {
    const project = projectOf([track('v', 0)], [clip('a', 'v', { src: 'a.svg' })])
    const loadImage = vi.fn(async () => ({ source: {} as CanvasImageSource, width: 0, height: 0 }))
    const rasterize = vi.fn(async (_s: CanvasImageSource, w: number, h: number) => new FakeBitmap(w, h) as unknown as ImageBitmap)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const out = await preDecodeSvgImages(project, undefined, { loadImage, rasterize })

    expect(rasterize).toHaveBeenCalledWith(expect.anything(), SVG_FALLBACK_SIZE, SVG_FALLBACK_SIZE)
    expect((out['a.svg'] as unknown as FakeBitmap).width).toBe(SVG_FALLBACK_SIZE)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('treats a rejecting contentType as not-SVG, and never loads it', async () => {
    const project = projectOf([track('v', 0)], [clip('x', 'v', { src: 'blob:x' })])
    const contentType = vi.fn(async () => {
      throw new Error('network down')
    })
    const loadImage = vi.fn(async () => ({ source: {} as CanvasImageSource, width: 10, height: 10 }))

    const out = await preDecodeSvgImages(project, undefined, { loadImage, contentType })

    expect(out).toEqual({})
    expect(loadImage).not.toHaveBeenCalled()
  })

  it('propagates a loadImage rejection', async () => {
    const project = projectOf([track('v', 0)], [clip('a', 'v', { src: 'a.svg' })])
    const loadImage = vi.fn(async () => {
      throw new Error('decode failed')
    })

    await expect(preDecodeSvgImages(project, undefined, { loadImage })).rejects.toThrow('decode failed')
  })
})
