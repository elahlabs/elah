import { describe, it, expect } from 'vitest'
import { generateId, mulberry32, seededIdsActive, withSeededIds } from './id'

describe('mulberry32', () => {
  it('is deterministic from its seed', () => {
    expect(mulberry32(1)()).toBe(0.6270739405881613)
  })
})

describe('withSeededIds', () => {
  it('makes generateId deterministic for a given seed', () => {
    expect(withSeededIds(1, () => [generateId(), generateId(), generateId()])).toEqual([
      'm0izyamp', 'fzgh5e85', 'h2era61f',
    ])
  })

  it('is deterministic for a different seed', () => {
    const [a, b, c] = withSeededIds(42, () => [generateId(), generateId(), generateId()])
    expect([a, b, c]).toEqual(['lguo6i9m', 'vh8vqb7i', 'ol0gu1l1'])
  })

  it('restarts the stream on every call', () => {
    expect(withSeededIds(1, generateId)).toBe('m0izyamp')
    expect(withSeededIds(1, generateId)).toBe('m0izyamp')
  })

  it('nests: the outer stream resumes after the inner one ends', () => {
    expect(withSeededIds(1, () => [generateId(), withSeededIds(2, generateId), generateId()])).toEqual([
      'm0izyamp', 'qbajvmhc', 'fzgh5e85',
    ])
  })

  it('issues 10,000 distinct, well-formed ids', () => {
    const ids = withSeededIds(9, () => Array.from({ length: 10000 }, () => generateId()))
    expect(new Set(ids).size).toBe(10000)
    for (const id of ids) expect(id).toMatch(/^[0-9a-z]{8}$/)
  })

  it('throws when fn returns a Promise, and leaves the scope inactive', () => {
    expect(() => withSeededIds(1, () => Promise.resolve('x'))).toThrow(/Promise/)
    expect(seededIdsActive()).toBe(false)
  })

  it('throws when fn returns an async-function Promise', () => {
    // eslint-disable-next-line @typescript-eslint/require-await
    expect(() => withSeededIds(1, async () => 'x')).toThrow(/Promise/)
    expect(seededIdsActive()).toBe(false)
  })

  it('propagates a synchronous throw from fn, and leaves the scope inactive', () => {
    expect(() =>
      withSeededIds(1, () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(seededIdsActive()).toBe(false)
  })
})

describe('generateId outside a scope', () => {
  it('returns the legacy shape: length at most 8, base36', () => {
    const id = generateId()
    expect(id.length).toBeLessThanOrEqual(8)
    expect(id).toMatch(/^[0-9a-z]*$/)
  })

  it('reports no active scope', () => {
    expect(seededIdsActive()).toBe(false)
  })
})
