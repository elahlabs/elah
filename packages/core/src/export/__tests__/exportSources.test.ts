import { describe, it, expect, vi } from 'vitest'
import { sourceAwareAudioResolver, sourceAwareFetch } from '../sources'

describe('export sources (LM-P1)', () => {
  it('sourceAwareFetch answers a supplied src without calling the fetcher', async () => {
    const fetcher = vi.fn(async () => new Blob(['network']))
    const file = new Blob(['local'])
    const fetchBlob = sourceAwareFetch({ 'blob:local': file }, fetcher)

    await expect(fetchBlob('blob:local', 'video')).resolves.toBe(file)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('sourceAwareFetch falls through for a src it was not given', async () => {
    const fetched = new Blob(['network'])
    const fetcher = vi.fn(async () => fetched)
    const fetchBlob = sourceAwareFetch({ 'blob:local': new Blob(['local']) }, fetcher)

    await expect(fetchBlob('https://cdn.example/a.mp4', 'image')).resolves.toBe(fetched)
    expect(fetcher).toHaveBeenCalledWith('https://cdn.example/a.mp4', 'image')
  })

  it('sourceAwareFetch is the fetcher itself when nothing is supplied', () => {
    const fetcher = vi.fn(async () => new Blob([]))
    expect(sourceAwareFetch(undefined, fetcher)).toBe(fetcher)
  })

  it('does not mistake inherited object keys for supplied sources', async () => {
    const fetcher = vi.fn(async () => new Blob(['network']))
    await sourceAwareFetch({}, fetcher)('constructor', 'video')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('sourceAwareAudioResolver reads a supplied src from its Blob and never calls the base resolver', async () => {
    const base = vi.fn(async () => new ArrayBuffer(0))
    const resolve = sourceAwareAudioResolver({ 'blob:local': new Blob([Uint8Array.from([1, 2, 3])]) }, base)

    const buf = await resolve('blob:local')
    expect(Array.from(new Uint8Array(buf))).toEqual([1, 2, 3])
    expect(base).not.toHaveBeenCalled()
  })

  it('sourceAwareAudioResolver falls through to the base resolver for other srcs', async () => {
    const out = new ArrayBuffer(4)
    const base = vi.fn(async () => out)
    const resolve = sourceAwareAudioResolver({ 'blob:local': new Blob(['x']) }, base)
    await expect(resolve('https://cdn.example/a.mp3')).resolves.toBe(out)
    expect(base).toHaveBeenCalledWith('https://cdn.example/a.mp3')
  })
})
