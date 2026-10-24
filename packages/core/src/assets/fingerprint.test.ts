import { describe, it, expect, vi } from 'vitest'
import { fingerprintBlob } from './fingerprint'

const bytes = (n: number, fill = (i: number) => (i * 31 + 7) & 0xff): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = fill(i)
  return out
}

describe('fingerprintBlob', () => {
  const CHUNK = 16

  it('gives local:<64 hex>', async () => {
    expect(await fingerprintBlob(new Blob([bytes(100)]), { chunkBytes: CHUNK })).toMatch(/^local:[0-9a-f]{64}$/)
  })

  it('is stable for the same bytes, whatever the blob type or parts', async () => {
    const data = bytes(200)
    const a = await fingerprintBlob(new Blob([data]), { chunkBytes: CHUNK })
    const b = await fingerprintBlob(new Blob([data.slice(0, 50), data.slice(50)], { type: 'video/mp4' }), { chunkBytes: CHUNK })
    expect(b).toBe(a)
  })

  it('changes when one byte in the middle chunk changes', async () => {
    const data = bytes(200)
    const edited = data.slice()
    const mid = Math.floor((200 - CHUNK) / 2) + 3
    edited[mid] ^= 0xff
    expect(await fingerprintBlob(new Blob([edited]), { chunkBytes: CHUNK })).not.toBe(
      await fingerprintBlob(new Blob([data]), { chunkBytes: CHUNK }),
    )
  })

  it('changes when the first or last byte changes', async () => {
    const data = bytes(200)
    const base = await fingerprintBlob(new Blob([data]), { chunkBytes: CHUNK })
    const head = data.slice()
    head[0] ^= 1
    const tail = data.slice()
    tail[199] ^= 1
    expect(await fingerprintBlob(new Blob([head]), { chunkBytes: CHUNK })).not.toBe(base)
    expect(await fingerprintBlob(new Blob([tail]), { chunkBytes: CHUNK })).not.toBe(base)
  })

  it('changes with the size even when every sampled byte is identical', async () => {
    const a = await fingerprintBlob(new Blob([bytes(100, () => 5)]), { chunkBytes: CHUNK })
    const b = await fingerprintBlob(new Blob([bytes(101, () => 5)]), { chunkBytes: CHUNK })
    expect(a).not.toBe(b)
  })

  it('ignores bytes outside the sampled head, middle and tail', async () => {
    const data = bytes(1000)
    const edited = data.slice()
    edited[CHUNK + 10] ^= 0xff // between head and middle
    expect(await fingerprintBlob(new Blob([edited]), { chunkBytes: CHUNK })).toBe(
      await fingerprintBlob(new Blob([data]), { chunkBytes: CHUNK }),
    )
  })

  it('reads at most three chunks of a large blob', async () => {
    const blob = new Blob([bytes(1000)])
    const slice = vi.spyOn(blob, 'slice')
    await fingerprintBlob(blob, { chunkBytes: CHUNK })
    expect(slice).toHaveBeenCalledTimes(3)
    for (const [start, end] of slice.mock.calls) expect((end as number) - (start as number)).toBeLessThanOrEqual(CHUNK)
  })

  it('hashes a blob of at most three chunks whole', async () => {
    const blob = new Blob([bytes(3 * CHUNK)])
    const slice = vi.spyOn(blob, 'slice')
    await fingerprintBlob(blob, { chunkBytes: CHUNK })
    expect(slice).toHaveBeenCalledTimes(1)
    expect(slice).toHaveBeenCalledWith(0, 3 * CHUNK)
  })

  it('handles an empty blob', async () => {
    expect(await fingerprintBlob(new Blob([]), { chunkBytes: CHUNK })).toMatch(/^local:[0-9a-f]{64}$/)
  })

  it('hashes the 8-byte little-endian size first, then the sampled bytes', async () => {
    const digest = vi.fn(async (data: ArrayBuffer) => new Uint8Array(32).buffer)
    await fingerprintBlob(new Blob([Uint8Array.from([9, 8, 7])]), { chunkBytes: CHUNK, digest })
    expect(Array.from(new Uint8Array(digest.mock.calls[0][0]))).toEqual([3, 0, 0, 0, 0, 0, 0, 0, 9, 8, 7])
  })

  it('uses crypto.subtle by default (known SHA-256 of an empty input plus size 0)', async () => {
    // 8 zero bytes hashed with SHA-256.
    expect(await fingerprintBlob(new Blob([]))).toBe(
      'local:af5570f5a1810b7af78caf4bc70a660f0df51e42baf91d4de5b2328de0e83dfc',
    )
  })
})
