import { beforeEach, describe, expect, it } from 'vitest'
import { TimelineEngine } from './TimelineEngine'
import { readProjectDocument } from './projectDocument'

/**
 * Track model: any number of tracks of any kind. Multiple video tracks
 * composite in track order (resolver derives zIndex from track.order), so
 * overlapping clips on separate video lanes layer instead of conflicting.
 */
describe('TimelineEngine — track model (multi video/audio/text)', () => {
  let engine: TimelineEngine

  beforeEach(() => {
    engine = new TimelineEngine({ fps: 30 })
  })

  const countKind = (kind: string) =>
    engine.getProject().tracks.filter((t) => t.kind === kind).length

  it('allows multiple video tracks, each a distinct lane', () => {
    // The engine starts with one default video track; each addTrack('video')
    // appends another lane instead of returning the existing one.
    const first = engine.addTrack('video')
    const second = engine.addTrack('video')
    expect(second.id).not.toBe(first.id)
    expect(countKind('video')).toBe(3)
    expect(second.order).toBeGreaterThan(first.order)
  })

  it('inserts a new video track directly below the last video track, above audio', () => {
    const audio = engine.addTrack('audio')
    const added = engine.addTrack('video')

    const tracks = engine.getProject().tracks
    const defaultVideo = tracks.find((t) => t.kind === 'video' && t.id !== added.id)!
    const audioNow = tracks.find((t) => t.id === audio.id)!

    expect(added.order).toBe(defaultVideo.order + 1)
    // The audio lane shifted down to make room and stays below all video lanes.
    expect(audioNow.order).toBeGreaterThan(added.order)
    // Orders remain unique and contiguous.
    const orders = tracks.map((t) => t.order).sort((a, b) => a - b)
    expect(orders).toEqual(orders.map((_, i) => i))
  })

  it('allows multiple audio tracks', () => {
    engine.addTrack('audio')
    engine.addTrack('audio')
    engine.addTrack('audio')
    expect(countKind('audio')).toBe(3)
  })

  it('allows multiple elements tracks', () => {
    engine.addTrack('elements')
    engine.addTrack('elements')
    expect(countKind('elements')).toBe(2)
  })
})

describe('TimelineEngine — pinned-bottom tracks', () => {
  it('a freely-added track inserts above the pinned block instead of after it', () => {
    const engine = new TimelineEngine({
      fps: 30,
      initialTracks: [
        { kind: 'video', name: 'Video' },
        { kind: 'audio', name: 'Audio', pinned: 'bottom' },
      ],
    })
    const [video, audio] = engine.getProject().tracks
    const added = engine.addTrack('elements')

    const tracks = engine.getProject().tracks
    const videoNow = tracks.find((t) => t.id === video.id)!
    const audioNow = tracks.find((t) => t.id === audio.id)!
    const addedNow = tracks.find((t) => t.id === added.id)!

    expect(videoNow.order).toBeLessThan(addedNow.order)
    expect(addedNow.order).toBeLessThan(audioNow.order)
    const orders = tracks.map((t) => t.order).sort((a, b) => a - b)
    expect(orders).toEqual(orders.map((_, i) => i))
  })

  it('a second pinned-bottom track (e.g. a generated subtitle lane) joins the block at the end, not above it', () => {
    const engine = new TimelineEngine({
      fps: 30,
      initialTracks: [
        { kind: 'video', name: 'Video' },
        { kind: 'audio', name: 'Audio', pinned: 'bottom' },
      ],
    })
    const [, audio] = engine.getProject().tracks
    const subtitleLane = engine.addTrack('elements', { pinned: 'bottom' })

    const tracks = engine.getProject().tracks
    const audioNow = tracks.find((t) => t.id === audio.id)!
    const laneNow = tracks.find((t) => t.id === subtitleLane.id)!
    expect(laneNow.order).toBeGreaterThan(audioNow.order)
  })

  it('with no pinned tracks, addTrack still just appends — unchanged default behaviour', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const added1 = engine.addTrack('elements')
    const added2 = engine.addTrack('audio')
    expect(added2.order).toBeGreaterThan(added1.order)
  })

  it('still inserts above the pinned block after a save → reload round trip', () => {
    // The pin only earns its keep if it survives the document. Before
    // `readTrack` carried `pinned`, this passed in a fresh session and then
    // silently stopped holding the moment the user reopened the project.
    const engine = new TimelineEngine({
      fps: 30,
      initialTracks: [
        { kind: 'video', name: 'Video' },
        { kind: 'audio', name: 'Audio', pinned: 'bottom' },
      ],
    })
    engine.loadProject(readProjectDocument(JSON.parse(JSON.stringify(engine.getProject()))))

    const audio = engine.getProject().tracks.find((t) => t.kind === 'audio')!
    expect(audio.pinned).toBe('bottom')

    const added = engine.addTrack('elements')
    const audioNow = engine.getProject().tracks.find((t) => t.id === audio.id)!
    expect(added.order).toBeLessThan(audioNow.order)
  })

  it('a new video track still inserts above the pinned block, shifting it down', () => {
    const engine = new TimelineEngine({
      fps: 30,
      initialTracks: [
        { kind: 'video', name: 'Video' },
        { kind: 'audio', name: 'Audio', pinned: 'bottom' },
      ],
    })
    const [, audio] = engine.getProject().tracks
    const secondVideo = engine.addTrack('video')

    const tracks = engine.getProject().tracks
    const audioNow = tracks.find((t) => t.id === audio.id)!
    const secondVideoNow = tracks.find((t) => t.id === secondVideo.id)!
    expect(secondVideoNow.order).toBeLessThan(audioNow.order)
  })
})

describe('TimelineEngine — protected tracks', () => {
  it('removeTrack is a no-op for a track created with protected: true', () => {
    const engine = new TimelineEngine({
      fps: 30,
      initialTracks: [{ kind: 'video', name: 'Video', protected: true }],
    })
    const [track] = engine.getProject().tracks
    expect(track.protected).toBe(true)

    engine.removeTrack(track.id)

    expect(engine.getProject().tracks).toHaveLength(1)
    expect(engine.getProject().tracks[0].id).toBe(track.id)
  })

  it('removeTrack still removes a non-protected track', () => {
    const engine = new TimelineEngine({
      fps: 30,
      initialTracks: [{ kind: 'video', name: 'Video', protected: true }],
    })
    const added = engine.addTrack('audio')

    engine.removeTrack(added.id)

    expect(engine.getProject().tracks.some((t) => t.id === added.id)).toBe(false)
  })

  it('per-track height in initialTracks overrides defaultTrackHeight', () => {
    const engine = new TimelineEngine({
      fps: 30,
      defaultTrackHeight: 36,
      initialTracks: [
        { kind: 'video', name: 'Video', height: 54 },
        { kind: 'audio', name: 'Audio' },
      ],
    })
    const [video, audio] = engine.getProject().tracks
    expect(video.height).toBe(54)
    expect(audio.height).toBe(36)
  })
})

describe('TimelineEngine — zero-track projects (AVM-P6)', () => {
  it('initialTracks: [] opens with no tracks and no clips', () => {
    const engine = new TimelineEngine({ fps: 30, initialTracks: [] })
    const project = engine.getProject()
    expect(project.tracks).toEqual([])
    expect(project.clips).toEqual({})
  })

  it('omitting initialTracks keeps the legacy single "Track 1" lane', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const { tracks } = engine.getProject()
    expect(tracks).toHaveLength(1)
    expect(tracks[0]!.name).toBe('Track 1')
    expect(tracks[0]!.kind).toBe('video')
  })

  it('addTrack works on an empty project', () => {
    const engine = new TimelineEngine({ fps: 30, initialTracks: [] })
    const track = engine.addTrack('audio')
    expect(engine.getProject().tracks.map((t) => t.id)).toEqual([track.id])
  })
})
