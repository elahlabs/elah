import { describe, expect, it, vi } from 'vitest'
import { probeHasAlpha, type LoadMediabunny } from '../alphaProbe'

function fakeMediabunny(opts: {
  track?: { canBeTransparent: () => Promise<boolean> } | null
  urlSourceSpy?: (src: string) => void
  blobSourceSpy?: (blob: Blob) => void
  disposeSpy?: () => void
}): LoadMediabunny {
  const { track = null, urlSourceSpy, blobSourceSpy, disposeSpy } = opts
  return async () =>
    ({
      ALL_FORMATS: [],
      UrlSource: class {
        constructor(src: string) {
          urlSourceSpy?.(src)
        }
      },
      BlobSource: class {
        constructor(blob: Blob) {
          blobSourceSpy?.(blob)
        }
      },
      Input: class {
        getPrimaryVideoTrack() {
          return Promise.resolve(track)
        }
        dispose() {
          disposeSpy?.()
        }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any
}

describe('probeHasAlpha', () => {
  it('returns true and disposes when the track can be transparent', async () => {
    const disposeSpy = vi.fn()
    const loadMediabunny = fakeMediabunny({
      track: { canBeTransparent: async () => true },
      disposeSpy,
    })
    await expect(probeHasAlpha('blob:x', async () => new Blob(), loadMediabunny)).resolves.toBe(true)
    expect(disposeSpy).toHaveBeenCalled()
  })

  it('returns false when there is no video track', async () => {
    const loadMediabunny = fakeMediabunny({ track: null })
    await expect(probeHasAlpha('blob:x', async () => new Blob(), loadMediabunny)).resolves.toBe(false)
  })

  it('uses UrlSource for an https: src', async () => {
    const urlSourceSpy = vi.fn()
    const loadMediabunny = fakeMediabunny({
      track: { canBeTransparent: async () => false },
      urlSourceSpy,
    })
    await probeHasAlpha('https://cdn.example.com/v.webm', async () => new Blob(), loadMediabunny)
    expect(urlSourceSpy).toHaveBeenCalledWith('https://cdn.example.com/v.webm')
  })

  it('uses BlobSource with the resolved blob for a blob: src', async () => {
    const blobSourceSpy = vi.fn()
    const blob = new Blob(['x'])
    const resolveBlob = vi.fn(async () => blob)
    const loadMediabunny = fakeMediabunny({
      track: { canBeTransparent: async () => false },
      blobSourceSpy,
    })
    await probeHasAlpha('blob:mock-1', resolveBlob, loadMediabunny)
    expect(resolveBlob).toHaveBeenCalledWith('blob:mock-1')
    expect(blobSourceSpy).toHaveBeenCalledWith(blob)
  })
})
