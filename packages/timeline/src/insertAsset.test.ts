import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimelineEngine, useMediaLibraryStore, usePlaybackStore, type MediaAsset } from '@elah/core'
import { useAudioDropDialogStore } from './audioDropDialog.store'
import { insertElement, insertMediaAsset } from './insertAsset'

const originalAudioRequest = useAudioDropDialogStore.getState().request
const originalAudioRespond = useAudioDropDialogStore.getState().respond

afterEach(() => {
  useMediaLibraryStore.setState({ assets: {}, order: [] })
  usePlaybackStore.setState({ currentFrame: 0 })
  useAudioDropDialogStore.setState({
    open: false,
    assetName: '',
    resolve: null,
    request: originalAudioRequest,
    respond: originalAudioRespond,
  })
  vi.restoreAllMocks()
})

describe('insertMediaAsset', () => {
  it('inserts media into the first compatible unlocked track at the playhead', async () => {
    const engine = new TimelineEngine({ fps: 30 })
    const videoTrack = engine.getProject().tracks[0]
    addAsset({ id: 'asset-video', kind: 'video', durationSec: 2 })
    usePlaybackStore.setState({ currentFrame: 12 })

    const result = await insertMediaAsset(engine, 'asset-video')

    expect(result).toMatchObject({ ok: true, kind: 'video', trackId: videoTrack.id })
    expect(engine.getClipsOnTrack(videoTrack.id)).toMatchObject([
      {
        type: 'video',
        assetId: 'asset-video',
        startFrame: 12,
        durationFrames: 60,
      },
    ])
  })

  it('skips locked compatible tracks', async () => {
    const engine = new TimelineEngine({ fps: 30 })
    const lockedAudio = engine.addTrack('audio', { name: 'Locked audio' })
    engine.updateTrack(lockedAudio.id, { locked: true })
    const unlockedAudio = engine.addTrack('audio', { name: 'Open audio' })
    addAsset({ id: 'asset-audio', kind: 'audio', durationSec: 1 })
    usePlaybackStore.setState({ currentFrame: 7 })

    const result = await insertMediaAsset(engine, 'asset-audio')

    expect(result).toMatchObject({ ok: true, kind: 'audio', trackId: unlockedAudio.id })
    expect(engine.getClipsOnTrack(lockedAudio.id)).toHaveLength(0)
    expect(engine.getClipsOnTrack(unlockedAudio.id)[0]).toMatchObject({
      type: 'audio',
      startFrame: 7,
      durationFrames: 30,
    })
  })

  it('creates an audio track when inserting audio with no audio lane', async () => {
    const engine = new TimelineEngine({ fps: 30 })
    addAsset({ id: 'asset-audio', kind: 'audio', durationSec: 1 })

    const result = await insertMediaAsset(engine, 'asset-audio', { desiredStartFrame: 4 })

    const audioTrack = engine.getProject().tracks.find((t) => t.kind === 'audio')
    expect(audioTrack).toBeDefined()
    expect(result).toMatchObject({ ok: true, kind: 'audio', trackId: audioTrack?.id })
    expect(engine.getClipsOnTrack(audioTrack!.id)[0]).toMatchObject({
      type: 'audio',
      startFrame: 4,
    })
  })

  it('returns a refusal when no compatible track can receive the asset', async () => {
    const engine = new TimelineEngine({
      fps: 30,
      initialTracks: [{ kind: 'audio', name: 'Audio only' }],
    })
    addAsset({ id: 'asset-image', kind: 'image', durationSec: 0 })

    const result = await insertMediaAsset(engine, 'asset-image')

    expect(result).toEqual({ ok: false, kind: 'image', reason: 'no-track' })
    expect(Object.values(engine.getProject().clips).flat()).toHaveLength(0)
  })

  it('resolves desiredStartFrame overlaps with the existing drop placement behavior', async () => {
    const engine = new TimelineEngine({ fps: 30 })
    const videoTrack = engine.getProject().tracks[0]
    engine.addClip({
      trackId: videoTrack.id,
      type: 'video',
      name: 'Existing',
      src: 'existing.mp4',
      startFrame: 10,
      durationFrames: 20,
    })
    addAsset({ id: 'asset-image', kind: 'image', durationSec: 1 })

    const result = await insertMediaAsset(engine, 'asset-image', { desiredStartFrame: 15 })

    expect(result).toMatchObject({ ok: true, kind: 'image' })
    expect(
      engine.getClipsOnTrack(videoTrack.id).map((clip) => ({
        type: clip.type,
        startFrame: clip.startFrame,
        durationFrames: clip.durationFrames,
      })),
    ).toEqual([
      { type: 'video', startFrame: 10, durationFrames: 20 },
      { type: 'image', startFrame: 30, durationFrames: 30 },
    ])
  })

  it('keeps video-with-audio insertion in one undo batch', async () => {
    const engine = new TimelineEngine({ fps: 30 })
    const videoTrack = engine.getProject().tracks[0]
    addAsset({
      id: 'asset-video-audio',
      kind: 'video',
      durationSec: 2,
      hasAudio: true,
    })
    const request = vi.fn(async () => 'both' as const)
    useAudioDropDialogStore.setState({ request })

    const result = await insertMediaAsset(engine, 'asset-video-audio', { desiredStartFrame: 3 })

    expect(request).toHaveBeenCalledWith('asset-video-audio.mov')
    expect(result).toMatchObject({ ok: true, kind: 'video', trackId: videoTrack.id })
    const audioTrack = engine.getProject().tracks.find((t) => t.kind === 'audio')
    expect(audioTrack).toBeDefined()
    expect(engine.getClipsOnTrack(videoTrack.id)[0]).toMatchObject({
      type: 'video',
      startFrame: 3,
      durationFrames: 60,
    })
    expect(engine.getClipsOnTrack(audioTrack!.id)[0]).toMatchObject({
      type: 'audio',
      startFrame: 3,
      durationFrames: 60,
    })

    expect(engine.undo()).toBe(true)
    expect(engine.canUndo()).toBe(false)
    expect(engine.getProject().tracks.some((t) => t.kind === 'audio')).toBe(false)
    expect(engine.getClipsOnTrack(videoTrack.id)).toHaveLength(0)
  })
})

describe('insertElement', () => {
  it('creates an elements track when inserting an element with no elements lane', () => {
    const engine = new TimelineEngine({ fps: 30 })
    usePlaybackStore.setState({ currentFrame: 9 })

    const result = insertElement(engine, { kind: 'element', element: 'text' })

    const elementsTrack = engine.getProject().tracks.find((t) => t.kind === 'elements')
    expect(elementsTrack).toBeDefined()
    expect(result).toMatchObject({ ok: true, kind: 'element', trackId: elementsTrack?.id })
    expect(engine.getClipsOnTrack(elementsTrack!.id)[0]).toMatchObject({
      type: 'text',
      name: 'Text 1',
      startFrame: 9,
      durationFrames: 90,
    })
  })
})

function addAsset(overrides: Partial<MediaAsset> & Pick<MediaAsset, 'id' | 'kind'>) {
  const asset: MediaAsset = {
    id: overrides.id,
    kind: overrides.kind,
    name: overrides.name ?? `${overrides.id}.mov`,
    src: overrides.src ?? `${overrides.id}.mov`,
    durationSec: overrides.durationSec ?? 0,
    byteSize: overrides.byteSize ?? 1024,
    lastModified: overrides.lastModified ?? 0,
    addedAt: overrides.addedAt ?? 0,
    hasAudio: overrides.hasAudio,
    thumbnailUrl: overrides.thumbnailUrl,
    width: overrides.width,
    height: overrides.height,
    sourceFps: overrides.sourceFps,
    thumbnailStrip: overrides.thumbnailStrip,
    waveform: overrides.waveform,
  }
  useMediaLibraryStore.getState().addAsset(asset)
}
