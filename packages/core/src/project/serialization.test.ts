import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { deserializeProject, serializeProject } from './serialization'

function buildNonTrivialEngine(): TimelineEngine {
  const engine = new TimelineEngine({
    fps: 30,
    stage: { width: 1080, height: 1920 },
    initialTracks: [{ kind: 'video', name: 'Video 1' }],
  })

  const videoTrack = engine.getProject().tracks[0]
  const textTrack = engine.addTrack('elements', { name: 'Text 1' })

  const clipA = engine.addClip({
    trackId: videoTrack.id,
    type: 'video',
    src: 'blob:clip-a',
    startFrame: 0,
    durationFrames: 90,
  })
  const clipB = engine.addClip({
    trackId: videoTrack.id,
    type: 'video',
    src: 'blob:clip-b',
    startFrame: 90,
    durationFrames: 60,
  })
  engine.addClip({
    trackId: textTrack.id,
    type: 'text',
    startFrame: 10,
    durationFrames: 45,
    text: { content: 'Hello world', fontSize: 48, color: '#ff0000' },
  })

  engine.addTransition({
    fromClipId: clipA.id,
    toClipId: clipB.id,
    trackId: videoTrack.id,
    kind: 'fade',
    durationFrames: 12,
  })

  engine.setStage(1920, 1080)
  engine.setMasterVolume(0.5)

  return engine
}

describe('serializeProject / deserializeProject', () => {
  it('round-trips a non-trivial project into a fresh engine with identical state and deterministic JSON', () => {
    const original = buildNonTrivialEngine()
    const json = serializeProject(original)

    const fresh = new TimelineEngine({ fps: 30 })
    deserializeProject(fresh, json)

    expect(fresh.getProject()).toEqual(original.getProject())

    const jsonAgain = serializeProject(fresh)
    expect(jsonAgain).toEqual(json)
  })

  it('round-trips into the same engine that produced the JSON', () => {
    const engine = buildNonTrivialEngine()
    const before = engine.getProject()
    const json = serializeProject(engine)

    deserializeProject(engine, json)

    expect(engine.getProject()).toEqual(before)
  })

  it.each([2, 0, 999])(
    'throws a clear error for unknown schema version %i',
    (version) => {
      const engine = new TimelineEngine({ fps: 30 })
      const project = engine.getProject()
      const json = JSON.stringify({ ...project, version })

      expect(() => deserializeProject(engine, json)).toThrowError(
        `Unsupported project schema version ${version} — this build of @elah/core supports version 1`,
      )
    },
  )

  it('throws the missing-version message when version is absent', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const project = engine.getProject() as unknown as Record<string, unknown>
    const { version, ...withoutVersion } = project
    void version
    const json = JSON.stringify(withoutVersion)

    expect(() => deserializeProject(engine, json)).toThrowError(
      'Not a valid project: missing schema version',
    )
  })

  it('throws with a "Not valid project JSON:" prefix on malformed JSON', () => {
    const engine = new TimelineEngine({ fps: 30 })

    expect(() => deserializeProject(engine, '{nope')).toThrowError(/^Not valid project JSON:/)
  })

  it.each([
    ['null', 'null'],
    ['a number', '42'],
    ['a string', '"str"'],
  ])('throws the non-object error for %s payloads', (_label, json) => {
    const engine = new TimelineEngine({ fps: 30 })

    expect(() => deserializeProject(engine, json)).toThrowError(
      'Not a valid project: expected a JSON object',
    )
  })

  it('rejects an array payload with a clear error (does not silently misinterpret it as a project)', () => {
    const engine = new TimelineEngine({ fps: 30 })

    // Arrays are `typeof 'object'` in JS; the implementation explicitly guards
    // against Array.isArray so `[]` is treated the same as any other non-object
    // shape rather than falling through to the tracks/clips checks.
    expect(() => deserializeProject(engine, '[]')).toThrowError(
      'Not a valid project: expected a JSON object',
    )
  })

  it('throws the tracks-not-an-array error', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const project = engine.getProject()
    const json = JSON.stringify({ ...project, tracks: {} })

    expect(() => deserializeProject(engine, json)).toThrowError(
      'Not a valid project: "tracks" must be an array',
    )
  })

  it('throws the clips-not-an-object error', () => {
    const engine = new TimelineEngine({ fps: 30 })
    const project = engine.getProject()
    const json = JSON.stringify({ ...project, clips: [] })

    expect(() => deserializeProject(engine, json)).toThrowError(
      'Not a valid project: "clips" must be an object',
    )
  })

  it('does not mutate the engine on a failed deserialization (no partial load)', () => {
    const engine = buildNonTrivialEngine()
    const before = engine.getProject()

    expect(() => deserializeProject(engine, '{nope')).toThrow()
    expect(() => deserializeProject(engine, 'null')).toThrow()
    expect(() =>
      deserializeProject(engine, JSON.stringify({ ...before, version: 2 })),
    ).toThrow()
    expect(() =>
      deserializeProject(engine, JSON.stringify({ ...before, tracks: {} })),
    ).toThrow()
    expect(() =>
      deserializeProject(engine, JSON.stringify({ ...before, clips: [] })),
    ).toThrow()

    expect(engine.getProject()).toEqual(before)
  })

  it('applies loadProject side effects: history is cleared and a change event fires', () => {
    const engine = buildNonTrivialEngine()
    // Give the engine some undo history before deserializing.
    engine.setMasterVolume(0.9)
    expect(engine.canUndo()).toBe(true)

    const changeEvents: unknown[] = []
    engine.on('change', (project) => changeEvents.push(project))

    const json = serializeProject(engine)
    deserializeProject(engine, json)

    expect(engine.canUndo()).toBe(false)
    expect(changeEvents.length).toBe(1)
  })
})
