/**
 * A hand-written STORED (uncompressed) ZIP writer with its own CRC-32.
 *
 * Plain byte layout, UTF-8
 * names and a "no compression, no ZIP64" scope, so PV-P9a's PNG sequences
 * can share it from `packages/core` without a second implementation to keep
 * in sync. No new dependency: everything a variant export produces (an MP4
 * Blob, or later a PNG sequence) is already-compressed bytes that DEFLATE
 * would spend CPU on for little gain, so `STORED` is the honest method.
 *
 * Sizes and offsets are 32-bit, which caps an archive at 4 GiB; that ceiling
 * is checked rather than assumed (see the throw below).
 */

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_END = 0x06054b50

/** PKZIP 2.0 — the version that defines `STORED` as implemented here. */
const VERSION = 20

/** General-purpose bit 11: the filename is UTF-8. Set unconditionally. */
const FLAG_UTF8 = 0x0800

/** No compression. */
const METHOD_STORED = 0

/** 32-bit offsets/sizes stop being able to describe the archive past this. */
const U32_LIMIT = 0xffffffff

/** The largest entry count a 16-bit "total entries" field can hold. */
const MAX_FILES = 65535

/** One file to store in the archive. */
export interface ZipFile {
  /** Path inside the archive; '/' separates folders; a leading '/' is stripped. */
  name: string
  data: Uint8Array
  /** Defaults to the time `zipStore` was called (one `Date` for the whole archive). */
  modified?: Date
}

// ---------------------------------------------------------------------------
// CRC-32
// ---------------------------------------------------------------------------

let crcTable: Uint32Array | null = null

function crc32Table(): Uint32Array {
  if (crcTable) return crcTable
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = (c & 1) === 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[n] = c >>> 0
  }
  crcTable = table
  return table
}

/** CRC-32 (IEEE 802.3, reflected, polynomial 0xEDB88320) as an unsigned 32-bit number. */
export function crc32(data: Uint8Array): number {
  const table = crc32Table()
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    c = table[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

// ---------------------------------------------------------------------------
// DOS date/time
// ---------------------------------------------------------------------------

function dosStamp(at: Date): { time: number; date: number } {
  const year = Math.max(1980, at.getFullYear())
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  }
}

// ---------------------------------------------------------------------------
// zipStore
// ---------------------------------------------------------------------------

interface PreparedFile {
  nameBytes: Uint8Array
  data: Uint8Array
  crc: number
  stamp: { time: number; date: number }
}

/**
 * A ZIP with every file STORED (no compression). Throws on an empty or
 * duplicate name, > 65,535 files, or > 4 GiB.
 */
export function zipStore(files: ReadonlyArray<ZipFile>): Uint8Array {
  if (files.length > MAX_FILES) {
    throw new Error(`zipStore: ${files.length} files exceeds the ${MAX_FILES}-entry ZIP limit`)
  }

  const now = new Date()
  const encoder = new TextEncoder()
  const seen = new Set<string>()

  const prepared: PreparedFile[] = files.map((f) => {
    const name = f.name.startsWith('/') ? f.name.slice(1) : f.name
    if (name.length === 0) throw new Error('zipStore: a file name must not be empty')
    if (seen.has(name)) throw new Error(`zipStore: duplicate name "${name}"`)
    seen.add(name)
    const nameBytes = encoder.encode(name)
    if (nameBytes.length > 0xffff) throw new Error(`zipStore: name "${name}" is too long`)
    return {
      nameBytes,
      data: f.data,
      crc: crc32(f.data),
      stamp: dosStamp(f.modified ?? now),
    }
  })

  // Local headers + data come first, in input order; the local offset of
  // each is what the central directory later points back at.
  const localOffsets: number[] = []
  let offset = 0
  for (const p of prepared) {
    localOffsets.push(offset)
    offset += 30 + p.nameBytes.length + p.data.length
  }
  const centralStart = offset
  let centralSize = 0
  for (const p of prepared) centralSize += 46 + p.nameBytes.length
  const total = centralStart + centralSize + 22

  if (centralStart > U32_LIMIT || total > U32_LIMIT) {
    throw new Error('zipStore: archive exceeds 4 GiB (ZIP64 is not supported)')
  }

  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)

  let at = 0
  for (const p of prepared) {
    view.setUint32(at, SIG_LOCAL, true)
    view.setUint16(at + 4, VERSION, true)
    view.setUint16(at + 6, FLAG_UTF8, true)
    view.setUint16(at + 8, METHOD_STORED, true)
    view.setUint16(at + 10, p.stamp.time, true)
    view.setUint16(at + 12, p.stamp.date, true)
    view.setUint32(at + 14, p.crc, true)
    view.setUint32(at + 18, p.data.length, true)
    view.setUint32(at + 22, p.data.length, true)
    view.setUint16(at + 26, p.nameBytes.length, true)
    view.setUint16(at + 28, 0, true) // no extra field
    out.set(p.nameBytes, at + 30)
    out.set(p.data, at + 30 + p.nameBytes.length)
    at += 30 + p.nameBytes.length + p.data.length
  }

  let centralAt = centralStart
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i]!
    view.setUint32(centralAt, SIG_CENTRAL, true)
    view.setUint16(centralAt + 4, VERSION, true)
    view.setUint16(centralAt + 6, VERSION, true)
    view.setUint16(centralAt + 8, FLAG_UTF8, true)
    view.setUint16(centralAt + 10, METHOD_STORED, true)
    view.setUint16(centralAt + 12, p.stamp.time, true)
    view.setUint16(centralAt + 14, p.stamp.date, true)
    view.setUint32(centralAt + 16, p.crc, true)
    view.setUint32(centralAt + 20, p.data.length, true)
    view.setUint32(centralAt + 24, p.data.length, true)
    view.setUint16(centralAt + 28, p.nameBytes.length, true)
    view.setUint16(centralAt + 30, 0, true) // no extra field
    view.setUint16(centralAt + 32, 0, true) // no comment
    view.setUint16(centralAt + 34, 0, true) // disk number start
    view.setUint16(centralAt + 36, 0, true) // internal attributes
    view.setUint32(centralAt + 38, 0o644 << 16, true) // external attributes
    view.setUint32(centralAt + 42, localOffsets[i]!, true)
    out.set(p.nameBytes, centralAt + 46)
    centralAt += 46 + p.nameBytes.length
  }

  const eocdAt = centralStart + centralSize
  view.setUint32(eocdAt, SIG_END, true)
  view.setUint16(eocdAt + 4, 0, true) // this disk
  view.setUint16(eocdAt + 6, 0, true) // disk with the central directory
  view.setUint16(eocdAt + 8, prepared.length, true)
  view.setUint16(eocdAt + 10, prepared.length, true)
  view.setUint32(eocdAt + 12, centralSize, true)
  view.setUint32(eocdAt + 16, centralStart, true)
  view.setUint16(eocdAt + 20, 0, true) // no archive comment

  return out
}
