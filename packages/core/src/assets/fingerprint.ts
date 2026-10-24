/**
 * Content fingerprint for a local media file (LM-P1).
 *
 * A name, a size and an mtime say "probably the same file"; they do not survive
 * a rename or a copy to another machine. This hashes the file's byte size plus
 * its first, middle and last chunk instead, so it reads about 3 MiB however
 * large the file is (a 10 GB MOV costs the same as a 4 MB one) and still tells
 * two different recordings apart. A file of at most three chunks is hashed
 * whole. Only a byte-identical head, middle, tail and size collide, which in
 * practice means a duplicate.
 *
 * Pure and Node-testable: it needs only `Blob.slice` and a SHA-256 digest.
 */

/** Bytes read from each of the head, middle and tail. */
export const FINGERPRINT_CHUNK_BYTES = 1024 * 1024

export interface FingerprintOptions {
  /** Size of each sampled chunk. Default 1 MiB. */
  chunkBytes?: number
  /** SHA-256 over the bytes. Default `crypto.subtle.digest('SHA-256', …)`. */
  digest?: (data: ArrayBuffer) => Promise<ArrayBuffer>
}

const defaultDigest = (data: ArrayBuffer): Promise<ArrayBuffer> => {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return Promise.reject(new Error('fingerprintBlob: crypto.subtle is not available'))
  return subtle.digest('SHA-256', data)
}

/** `local:<sha256 hex>` over the 8-byte little-endian size and the sampled chunks. */
export async function fingerprintBlob(blob: Blob, opts: FingerprintOptions = {}): Promise<string> {
  const chunk = Math.max(1, Math.floor(opts.chunkBytes ?? FINGERPRINT_CHUNK_BYTES))
  const digest = opts.digest ?? defaultDigest
  const size = blob.size

  const ranges: Array<[number, number]> =
    size <= chunk * 3
      ? [[0, size]]
      : [
          [0, chunk],
          [Math.floor((size - chunk) / 2), Math.floor((size - chunk) / 2) + chunk],
          [size - chunk, size],
        ]

  const parts: Uint8Array[] = []
  for (const [start, end] of ranges) {
    parts.push(new Uint8Array(await blob.slice(start, end).arrayBuffer()))
  }

  const total = 8 + parts.reduce((n, p) => n + p.byteLength, 0)
  const bytes = new Uint8Array(total)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, size % 0x1_0000_0000, true)
  view.setUint32(4, Math.floor(size / 0x1_0000_0000), true)
  let offset = 8
  for (const p of parts) {
    bytes.set(p, offset)
    offset += p.byteLength
  }

  const hash = new Uint8Array(await digest(bytes.buffer))
  let hex = ''
  for (const b of hash) hex += b.toString(16).padStart(2, '0')
  return `local:${hex}`
}
