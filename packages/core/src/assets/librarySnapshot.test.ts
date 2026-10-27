import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hydrateMediaLibrary,
  refreshMissingThumbnails,
  snapshotMediaLibrary,
} from './librarySnapshot'
import { mediaLibraryStore } from './store'
import type { MediaAsset } from './types'

function asset(overrides: Partial<MediaAsset> & Pick<MediaAsset, 'id'>): MediaAsset {
  return {
    kind: 'video',
    name: `${overrides.id}.mp4`,
    src: `https://cdn.example.com/${overrides.id}.mp4`,
    durationSec: 5,
    byteSize: 100,
    lastModified: 0,
    addedAt: 0,
    ...overrides,
  }
}

function add(a: MediaAsset): MediaAsset {
  mediaLibraryStore.getState().addAsset(a)
  return a
}

const library = () => mediaLibraryStore.getState()
const NO_CLIPS = { referencedSrcs: new Set<string>() }

beforeEach(() => {
  mediaLibraryStore.setState({ assets: {}, order: [] })
})

describe('snapshotMediaLibrary', () => {
  it('carries the fields a page load would otherwise destroy', () => {
    const waveform = new Float32Array([0.1, 0.9])
    add(
      asset({
        id: 'v1',
        width: 1920,
        height: 1080,
        hasAudio: true,
        thumbnailUrl: 'data:image/jpeg;base64,MID',
        thumbnailStrip: ['data:image/jpeg;base64,A', 'data:image/jpeg;base64,B'],
        waveform,
      }),
    )

    const [entry] = snapshotMediaLibrary(library())

    expect(entry).toMatchObject({
      id: 'v1',
      src: 'https://cdn.example.com/v1.mp4',
      width: 1920,
      height: 1080,
      hasAudio: true,
      thumbnailStrip: ['data:image/jpeg;base64,A', 'data:image/jpeg;base64,B'],
      thumbnailUrl: 'data:image/jpeg;base64,MID',
    })
    expect(entry.waveform).toBe(waveform)
  })

  it('skips an asset whose real duration is not known yet', () => {
    // Its duration and dimensions are fallback guesses; storing them would
    // restore the clip at a width that was only ever provisional.
    add(asset({ id: 'ready' }))
    add(asset({ id: 'probing', status: 'pending' }))

    expect(snapshotMediaLibrary(library()).map((e) => e.id)).toEqual(['ready'])
  })

  it('round-trips through hydrate under the same ids', () => {
    add(asset({ id: 'v1', thumbnailStrip: ['a'] }))
    add(asset({ id: 'v2', kind: 'audio', waveform: new Float32Array([0.5]) }))
    const stored = snapshotMediaLibrary(library())

    mediaLibraryStore.setState({ assets: {}, order: [] })
    const result = hydrateMediaLibrary(stored, NO_CLIPS)

    expect(result.hydrated).toEqual(['v1', 'v2'])
    expect(library().getAsset('v1')?.thumbnailStrip).toEqual(['a'])
    expect(library().getAsset('v2')?.waveform).toEqual(new Float32Array([0.5]))
    // A stored asset has finished probing by definition.
    expect(library().getAsset('v1')?.status).toBe('ready')
  })
})

describe('hydrateMediaLibrary', () => {
  it('never overwrites an asset this session already has', () => {
    add(asset({ id: 'v1', name: 'live.mp4', thumbnailStrip: ['fresh'] }))

    const result = hydrateMediaLibrary(
      [asset({ id: 'v1', name: 'stale.mp4', thumbnailStrip: ['old'] })],
      NO_CLIPS,
    )

    expect(result.hydrated).toEqual([])
    expect(library().getAsset('v1')?.thumbnailStrip).toEqual(['fresh'])
  })

  it('skips a stored entry whose src is already in the library under another id', () => {
    // The project's own asset fetch re-imports under a fresh id; hydrating the
    // stored copy too would put the same video in the panel twice.
    add(asset({ id: 'fresh-id', src: 'https://cdn.example.com/same.mp4' }))

    const result = hydrateMediaLibrary(
      [asset({ id: 'stored-id', src: 'https://cdn.example.com/same.mp4' })],
      NO_CLIPS,
    )

    expect(result.hydrated).toEqual([])
    expect(library().order).toEqual(['fresh-id'])
  })

  it('restores a dead blob: source only when a restored clip still points at it', () => {
    const used = asset({ id: 'used', src: 'blob:http://localhost/used', thumbnailStrip: ['a'] })
    const orphan = asset({ id: 'orphan', src: 'blob:http://localhost/orphan' })

    const result = hydrateMediaLibrary([used, orphan], {
      referencedSrcs: new Set(['blob:http://localhost/used']),
    })

    // The stored strip is the only thing keeping that clip from being an
    // anonymous grey rectangle; the orphan is just litter.
    expect(result.hydrated).toEqual(['used'])
    expect(library().getAsset('used')?.thumbnailStrip).toEqual(['a'])
    expect(library().getAsset('orphan')).toBeUndefined()
  })

  it('never asks for a decode it knows will fail', () => {
    const dead = asset({ id: 'dead', src: 'blob:http://localhost/dead' })

    const result = hydrateMediaLibrary([dead], {
      referencedSrcs: new Set(['blob:http://localhost/dead']),
    })

    expect(result.hydrated).toEqual(['dead'])
    expect(result.needsThumbnail).toEqual([])
  })

  it('flags only fetchable entries that came back without thumbnails', () => {
    const result = hydrateMediaLibrary(
      [
        asset({ id: 'has-strip', thumbnailStrip: ['a'] }),
        asset({ id: 'has-thumb', thumbnailUrl: 'data:image/jpeg;base64,x' }),
        asset({ id: 'bare' }),
        asset({ id: 'empty-strip', thumbnailStrip: [] }),
      ],
      NO_CLIPS,
    )

    expect(result.needsThumbnail).toEqual(['bare', 'empty-strip'])
  })
})

describe('refreshMissingThumbnails', () => {
  it('asks for one decode per asset', () => {
    const schedule = vi.fn()

    refreshMissingThumbnails(['a', 'b'], schedule)

    expect(schedule).toHaveBeenCalledTimes(2)
    expect(schedule).toHaveBeenNthCalledWith(1, 'a')
    expect(schedule).toHaveBeenNthCalledWith(2, 'b')
  })
})

describe('hydrateMediaLibrary remap (LM-P3)', () => {
  const DEAD = 'blob:http://localhost/dead'
  const FRESH = 'blob:http://localhost/fresh'
  const media = { v: 1 as const, id: 'local:' + 'ab'.repeat(32), name: 'v.mp4', byteSize: 9, lastModified: 1, kind: 'video' as const }
  const toFresh = (e: MediaAsset): MediaAsset => (e.media?.id === media.id ? { ...e, src: FRESH } : e)

  it('restores an entry under the fresh src, keeping its id and thumbnails', () => {
    const stored = asset({ id: 'v1', src: DEAD, media, thumbnailStrip: ['a'] })

    const result = hydrateMediaLibrary([stored], { referencedSrcs: new Set([FRESH]), remap: toFresh })

    expect(result.hydrated).toEqual(['v1'])
    expect(library().getAsset('v1')?.src).toBe(FRESH)
    expect(library().getAsset('v1')?.thumbnailStrip).toEqual(['a'])
    expect(result.needsThumbnail).toEqual([])
  })

  it('matches referencedSrcs against the remapped src, not the stored one', () => {
    const stored = asset({ id: 'v1', src: DEAD, media })

    const result = hydrateMediaLibrary([stored], { referencedSrcs: new Set([DEAD]), remap: toFresh })

    expect(result.hydrated).toEqual([])
  })

  it('leaves entries the remap does not touch as stored', () => {
    const other = asset({ id: 'v2', src: 'blob:http://localhost/other' })

    const result = hydrateMediaLibrary([other], { referencedSrcs: new Set([other.src]), remap: toFresh })

    expect(library().getAsset('v2')?.src).toBe(other.src)
    expect(result.hydrated).toEqual(['v2'])
  })

  it('still never overwrites an asset this session already has', () => {
    add(asset({ id: 'v1', src: 'https://cdn.example.com/live.mp4', name: 'live' }))

    hydrateMediaLibrary([asset({ id: 'v1', src: DEAD, media, name: 'stored' })], {
      referencedSrcs: new Set([FRESH]),
      remap: toFresh,
    })

    expect(library().getAsset('v1')?.name).toBe('live')
    expect(library().getAsset('v1')?.src).toBe('https://cdn.example.com/live.mp4')
  })
})
