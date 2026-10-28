import { describe, expect, it } from 'vitest'
import { crc32, zipStore, type ZipFile } from './zipStore'

/**
 * The archive is read by an extractor we do not control, so these assert the
 * bytes directly: signatures where the spec puts them, sizes and CRCs that
 * match the payload, and a central directory whose offsets point at the local
 * headers they claim to.
 */

function enc(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function u16(data: Uint8Array, at: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(at, true)
}

function u32(data: Uint8Array, at: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(at, true)
}

/** Walks local headers by signature from offset 0 — a minimal reader for the round-trip test. */
function readZip(zip: Uint8Array): Array<{ name: string; data: Uint8Array }> {
  const out: Array<{ name: string; data: Uint8Array }> = []
  let at = 0
  while (at < zip.length && u32(zip, at) === 0x04034b50) {
    const nameLen = u16(zip, at + 26)
    const dataLen = u32(zip, at + 18)
    const nameStart = at + 30
    const dataStart = nameStart + nameLen
    out.push({
      name: new TextDecoder().decode(zip.slice(nameStart, dataStart)),
      data: zip.slice(dataStart, dataStart + dataLen),
    })
    at = dataStart + dataLen
  }
  return out
}

describe('crc32', () => {
  it('matches the known IEEE check values', () => {
    expect(crc32(enc(''))).toBe(0)
    expect(crc32(enc('123456789'))).toBe(0xcbf43926)
    expect(crc32(enc('hello'))).toBe(0x3610a686)
    expect(crc32(enc('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
  })
})

describe('zipStore', () => {
  const FIXED = new Date(2026, 8, 25, 13, 45, 30)

  it('writes one file with the exact byte layout the ticket specifies', () => {
    const zip = zipStore([{ name: 'a.txt', data: enc('hello'), modified: FIXED }])

    // Total length: 30 + 5 (name) + 5 (data) local, 46 + 5 central, 22 EOCD.
    expect(zip.length).toBe(113)

    // Local header.
    expect(u32(zip, 0)).toBe(0x04034b50)
    expect(u16(zip, 4)).toBe(20)
    expect(u16(zip, 6)).toBe(0x0800)
    expect(u16(zip, 8)).toBe(0)
    expect(u16(zip, 10)).toBe(28079)
    expect(u16(zip, 12)).toBe(23865)
    expect(u32(zip, 14)).toBe(0x3610a686)
    expect(u32(zip, 18)).toBe(5)
    expect(u32(zip, 22)).toBe(5)
    expect(u16(zip, 26)).toBe(5)
    expect(u16(zip, 28)).toBe(0)

    // Name at 30-35, data at 35-40.
    expect(new TextDecoder().decode(zip.slice(30, 35))).toBe('a.txt')
    expect(new TextDecoder().decode(zip.slice(35, 40))).toBe('hello')

    // Central header at 40.
    expect(u32(zip, 40)).toBe(0x02014b50)
    expect(u16(zip, 44)).toBe(20)
    expect(u16(zip, 46)).toBe(20)
    expect(u32(zip, 78)).toBe(0x01a40000)
    expect(u32(zip, 82)).toBe(0)

    // EOCD at 91.
    expect(u32(zip, 91)).toBe(0x06054b50)
    expect(u16(zip, 99)).toBe(1)
    expect(u16(zip, 101)).toBe(1)
    expect(u32(zip, 103)).toBe(51)
    expect(u32(zip, 107)).toBe(40)
  })

  it('places a second file after the first, with the central directory pointing back', () => {
    const files: ZipFile[] = [
      { name: 'a.txt', data: enc('hello'), modified: FIXED },
      { name: 'b/c.bin', data: new Uint8Array([1, 2, 3]), modified: FIXED },
    ]
    const zip = zipStore(files)

    // First local header 40 bytes (30 + 'a.txt'.length=5 + 5), then the
    // second local header starts at 40: 30 + 'b/c.bin'.length=7 + 3 = 40.
    const secondLocalOffset = 40
    expect(u32(zip, secondLocalOffset)).toBe(0x04034b50)

    const firstCentralOffset = secondLocalOffset + 40 // second local block is 40 bytes
    const secondCentralOffset = firstCentralOffset + 46 + 5 // first central entry: 46 + 'a.txt'.length
    expect(u32(zip, secondCentralOffset)).toBe(0x02014b50)
    expect(u32(zip, secondCentralOffset + 42)).toBe(secondLocalOffset)

    const eocdAt = zip.length - 22
    expect(u32(zip, eocdAt)).toBe(0x06054b50)
    expect(u16(zip, eocdAt + 10)).toBe(2)
  })

  it('round-trips through a from-scratch reader, including a two-byte accented name', () => {
    const files: ZipFile[] = [
      { name: 'a.txt', data: enc('hello'), modified: FIXED },
      { name: 'b/c.bin', data: new Uint8Array([1, 2, 3]), modified: FIXED },
      { name: 'é.txt', data: enc('x'), modified: FIXED },
    ]
    const zip = zipStore(files)
    const read = readZip(zip)

    expect(read).toHaveLength(3)
    expect(read[0]!.name).toBe('a.txt')
    expect(read[0]!.data).toEqual(enc('hello'))
    expect(read[1]!.name).toBe('b/c.bin')
    expect(read[1]!.data).toEqual(new Uint8Array([1, 2, 3]))
    expect(read[2]!.name).toBe('é.txt')
    expect(read[2]!.data).toEqual(enc('x'))
  })

  it('gives every header the same time and date when modified is omitted', () => {
    const zip = zipStore([{ name: 'a.txt', data: enc('a') }, { name: 'b.txt', data: enc('b') }])
    const firstLocalTime = u16(zip, 10)
    const firstLocalDate = u16(zip, 12)
    const secondLocalOffset = 30 + 5 + 1 // 'a.txt' local block
    expect(u16(zip, secondLocalOffset + 10)).toBe(firstLocalTime)
    expect(u16(zip, secondLocalOffset + 12)).toBe(firstLocalDate)
  })

  it('strips a leading slash', () => {
    const zip = zipStore([{ name: '/x.txt', data: enc('x'), modified: FIXED }])
    expect(u16(zip, 26)).toBe(5) // 'x.txt'
    expect(new TextDecoder().decode(zip.slice(30, 35))).toBe('x.txt')
  })

  it('throws for an empty name, a duplicate name, or a leading-slash-only name', () => {
    expect(() => zipStore([{ name: '', data: enc('x') }])).toThrow()
    expect(() => zipStore([
      { name: 'a.txt', data: enc('1') },
      { name: 'a.txt', data: enc('2') },
    ])).toThrow(/duplicate/i)
    expect(() => zipStore([{ name: '/', data: enc('x') }])).toThrow()
  })

  it('handles an empty archive', () => {
    const zip = zipStore([])
    expect(zip.length).toBe(22)
    expect(u32(zip, 0)).toBe(0x06054b50)
    expect(u16(zip, 8)).toBe(0)
  })
})
