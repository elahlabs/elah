import { describe, expect, it } from 'vitest'
import { buildVideo, type AuthoredSpec } from '@elah/core/spec'
import { titleCardSpec } from './titleCardSpec'

describe('titleCardSpec', () => {
  it('builds with no errors and produces clips with keyframes', () => {
    const built = buildVideo(titleCardSpec as unknown as AuthoredSpec)
    expect(built.issues.filter((i) => i.severity === 'error').map((i) => `${i.path}: ${i.message}`)).toEqual([])
    const clips = Object.values(built.project.clips).flat()
    expect(clips.length).toBeGreaterThan(0)
    expect(clips.some((c) => Object.keys(c.keyframes?.channels ?? {}).length > 0)).toBe(true)
  })
})
