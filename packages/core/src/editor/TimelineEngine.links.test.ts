import { describe, expect, it } from 'vitest'
import { TimelineEngine } from './TimelineEngine'
import { expandLinked, splitLinked } from '../actions/links'
import { describeProject } from '../ops/describe'

/** Linked clips (PV-T1): groups that move, trim, split and delete together. */

function setup() {
  const engine = new TimelineEngine({
    fps: 30,
    initialTracks: [
      { kind: 'video', name: 'V1' },
      { kind: 'audio', name: 'A1' },
    ],
  })
  const [v1, a1] = engine.getProject().tracks.map((t) => t.id) as [string, string]
  const video = (name: string, start: number, dur: number) =>
    engine.addClip({ trackId: v1, type: 'video', src: `${name}.mp4`, name, startFrame: start, durationFrames: dur }).id
  const audio = (name: string, start: number, dur: number) =>
    engine.addClip({ trackId: a1, type: 'audio', src: `${name}.wav`, name, startFrame: start, durationFrames: dur }).id
  const link = (id: string) => engine.findClip(id)!.clip.linkId
  return { engine, v1, a1, video, audio, link }
}

describe('linkClips / unlinkClips / getLinked', () => {
  it('links two or more clips as one undo step and finds the group from any member', () => {
    const { engine, video, audio, link } = setup()
    const v = video('v', 0, 30)
    const a = audio('a', 0, 30)

    const id = engine.linkClips([v, a])

    expect(id).toBeTruthy()
    expect(link(v)).toBe(id)
    expect(link(a)).toBe(id)
    expect(engine.getLinked(a).map((c) => c.id).sort()).toEqual([v, a].sort())
    expect(engine.lastHistoryDescription()).toBe('Link clips')
  })

  it('refuses fewer than two known clips', () => {
    const { engine, video } = setup()
    const v = video('v', 0, 30)
    expect(engine.linkClips([v])).toBeNull()
    expect(engine.linkClips([v, 'nope'])).toBeNull()
  })

  it('dissolves a group left with one member', () => {
    const { engine, video, audio, link } = setup()
    const v = video('v', 0, 30)
    const a = audio('a', 0, 30)
    const b = audio('b', 40, 30)
    engine.linkClips([v, a])

    const next = engine.linkClips([a, b])

    expect(link(v)).toBeUndefined()
    expect(link(a)).toBe(next)
    expect(link(b)).toBe(next)
  })

  it('unlinking leaves the rest of the group linked until one remains', () => {
    const { engine, video, audio, link } = setup()
    const v = video('v', 0, 30)
    const a = audio('a', 0, 30)
    const b = audio('b', 40, 30)
    const id = engine.linkClips([v, a, b])

    engine.unlinkClips([v])
    expect(link(v)).toBeUndefined()
    expect(link(a)).toBe(id)

    engine.unlinkClips([a])
    expect(link(b)).toBeUndefined()
  })

  it('getLinked is the clip alone when unlinked, and empty when unknown', () => {
    const { engine, video } = setup()
    const v = video('v', 0, 30)
    expect(engine.getLinked(v).map((c) => c.id)).toEqual([v])
    expect(engine.getLinked('nope')).toEqual([])
  })
})

describe('splitting and copying never extend a group', () => {
  it('a split’s right half is unlinked; the left half keeps the group', () => {
    const { engine, v1, video, audio, link } = setup()
    const v = video('v', 0, 60)
    const a = audio('a', 0, 60)
    const id = engine.linkClips([v, a])

    const [, right] = engine.splitClip(v, v1, 30)!

    expect(link(v)).toBe(id)
    expect(link(right)).toBeUndefined()
  })

  it('a clone is unlinked', () => {
    const { engine, v1, video, audio, link } = setup()
    const v = video('v', 0, 30)
    engine.linkClips([v, audio('a', 0, 30)])
    const copy = engine.cloneClip(v, v1, 100)!
    expect(link(copy)).toBeUndefined()
  })

  it('splitLinked cuts the whole group and links the right halves to each other', () => {
    const { engine, video, audio, link } = setup()
    const v = video('v', 0, 60)
    const a = audio('a', 0, 60)
    const id = engine.linkClips([v, a])

    const r = splitLinked(engine, v, 30)

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.left.sort()).toEqual([v, a].sort())
    expect(r.data.right).toHaveLength(2)
    const rightLinks = r.data.right.map(link)
    expect(rightLinks[0]).toBeDefined()
    expect(rightLinks[0]).toBe(rightLinks[1])
    expect(rightLinks[0]).not.toBe(id)
    expect(link(v)).toBe(id)
    expect(link(a)).toBe(id)
    expect(engine.lastHistoryDescription()).toBe('Split clips')
  })

  it('splitLinked refuses a frame outside every member', () => {
    const { engine, video, audio } = setup()
    const v = video('v', 0, 60)
    engine.linkClips([v, audio('a', 0, 60)])
    expect(splitLinked(engine, v, 60)).toEqual({ ok: false, reason: 'playhead-outside-clip' })
  })
})

describe('expandLinked and describeProject', () => {
  it('adds every partner after the given ids, each once', () => {
    const { engine, video, audio } = setup()
    const v = video('v', 0, 30)
    const a = audio('a', 0, 30)
    const lone = video('lone', 40, 10)
    engine.linkClips([v, a])

    expect(expandLinked(engine.getProject(), [a])).toEqual([a, v])
    expect(expandLinked(engine.getProject(), [lone, a, v, 'nope'])).toEqual([lone, a, v])
  })

  it('reports the link group to the agent, and nothing for unlinked clips', () => {
    const { engine, video, audio } = setup()
    const v = video('v', 0, 30)
    const lone = video('lone', 40, 10)
    const id = engine.linkClips([v, audio('a', 0, 30)])
    const clips = describeProject(engine.getProject()).tracks.flatMap((t) => t.clips)
    expect(clips.find((c) => c.id === v)?.linked).toBe(id)
    expect(clips.find((c) => c.id === lone)).not.toHaveProperty('linked')
  })
})
