import { describe, expect, it } from 'vitest'
import { fileStem, findPairedMatte, matteStem } from './mattePairing'
import type { MediaAsset } from './types'

let nextId = 0
function asset(overrides: Partial<MediaAsset> & Pick<MediaAsset, 'name' | 'kind'>): MediaAsset {
  nextId += 1
  return {
    id: `a${nextId}`,
    src: `blob:${nextId}`,
    durationSec: 1,
    byteSize: 0,
    lastModified: 0,
    addedAt: nextId,
    ...overrides,
  }
}

describe('matteStem', () => {
  it('reads the stem before _matte or _alpha, case-insensitively', () => {
    expect(matteStem('clip_matte.mp4')).toBe('clip')
    expect(matteStem('clip_MATTE.mov')).toBe('clip')
    expect(matteStem('clip_alpha.webm')).toBe('clip')
    expect(matteStem('a_b_matte.png')).toBe('a_b')
  })

  it('returns null for a plain name', () => {
    expect(matteStem('clip.mp4')).toBeNull()
  })
})

describe('fileStem', () => {
  it('strips only the last extension', () => {
    expect(fileStem('my.clip.mp4')).toBe('my.clip')
  })

  it('returns the name unchanged when there is no extension', () => {
    expect(fileStem('noext')).toBe('noext')
  })
})

describe('findPairedMatte', () => {
  it('matches a _matte file', () => {
    const clip = asset({ name: 'clip.mp4', kind: 'video' })
    const matte = asset({ name: 'clip_matte.mp4', kind: 'video' })
    expect(findPairedMatte(clip, [clip, matte])).toBe(matte)
  })

  it('matches an _alpha file', () => {
    const clip = asset({ name: 'clip.mp4', kind: 'video' })
    const matte = asset({ name: 'clip_alpha.webm', kind: 'video' })
    expect(findPairedMatte(clip, [clip, matte])).toBe(matte)
  })

  it('prefers _matte over _alpha when both are present', () => {
    const clip = asset({ name: 'clip.mp4', kind: 'video' })
    const alpha = asset({ name: 'clip_alpha.webm', kind: 'video' })
    const matte = asset({ name: 'clip_matte.mp4', kind: 'video' })
    expect(findPairedMatte(clip, [clip, alpha, matte])).toBe(matte)
  })

  it('is case-insensitive', () => {
    const clip = asset({ name: 'Clip.MP4', kind: 'video' })
    const matte = asset({ name: 'clip_MATTE.mov', kind: 'video' })
    expect(findPairedMatte(clip, [clip, matte])).toBe(matte)
  })

  it('requires the same kind', () => {
    const clip = asset({ name: 'clip.mp4', kind: 'video' })
    const imageMatte = asset({ name: 'clip_matte.png', kind: 'image' })
    expect(findPairedMatte(clip, [clip, imageMatte])).toBeUndefined()
  })

  it('is undefined when the asset itself is a matte file', () => {
    const matte = asset({ name: 'clip_matte.mp4', kind: 'video' })
    const other = asset({ name: 'clip.mp4', kind: 'video' })
    expect(findPairedMatte(matte, [matte, other])).toBeUndefined()
  })

  it('skips a candidate with hasAlpha true', () => {
    const clip = asset({ name: 'clip.mp4', kind: 'video' })
    const alpha = asset({ name: 'clip_alpha.webm', kind: 'video', hasAlpha: true })
    expect(findPairedMatte(clip, [clip, alpha])).toBeUndefined()
  })

  it('matches when the base name itself has a dot', () => {
    const clip = asset({ name: 'my.clip.mp4', kind: 'video' })
    const matte = asset({ name: 'my.clip_matte.mp4', kind: 'video' })
    expect(findPairedMatte(clip, [clip, matte])).toBe(matte)
  })

  it('does not match an unrelated stem', () => {
    const clip = asset({ name: 'clip.mp4', kind: 'video' })
    const other = asset({ name: 'other_matte.mp4', kind: 'video' })
    expect(findPairedMatte(clip, [clip, other])).toBeUndefined()
  })

  it('picks the more recent addedAt when two _matte candidates tie', () => {
    const clip = asset({ name: 'clip.mp4', kind: 'video' })
    const older = asset({ name: 'clip_matte.mp4', kind: 'video', addedAt: 1 })
    const newer = asset({ name: 'clip_matte.mp4', kind: 'video', addedAt: 2 })
    expect(findPairedMatte(clip, [clip, older, newer])).toBe(newer)
  })

  it('is undefined for an audio asset', () => {
    const audio = asset({ name: 'clip.mp3', kind: 'audio' })
    const matte = asset({ name: 'clip_matte.mp3', kind: 'audio' })
    expect(findPairedMatte(audio, [audio, matte])).toBeUndefined()
  })
})
