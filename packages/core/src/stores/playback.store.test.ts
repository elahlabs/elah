import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The store used to be wrapped in zustand's `persist` middleware, which writes
 * `localStorage` on *every* mutation regardless of whether a persisted field
 * moved. `setCurrentFrame` fires ~30 times a second during playback and once
 * per pointermove while scrubbing, so the editor was doing a synchronous
 * stringify-and-write dozens of times a second to re-save six unchanged values.
 * These pin the fix, and pin that the user's preferences still survive it.
 */

interface FakeStorage {
  getItem: ReturnType<typeof vi.fn>
  setItem: ReturnType<typeof vi.fn>
  removeItem: ReturnType<typeof vi.fn>
}

function fakeStorage(seed?: Record<string, string>): FakeStorage {
  const data = new Map(Object.entries(seed ?? {}))
  return {
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
    removeItem: vi.fn((k: string) => void data.delete(k)),
  }
}

/** Import the store fresh so module-init persistence reads `storage`. */
async function loadStore(storage: FakeStorage) {
  vi.resetModules()
  vi.stubGlobal('localStorage', storage)
  const mod = await import('./playback.store')
  return mod.playbackStore
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('playbackStore persistence', () => {
  it('never writes storage while the playhead moves', async () => {
    const storage = fakeStorage()
    const store = await loadStore(storage)

    for (let frame = 0; frame < 100; frame++) {
      store.getState().setCurrentFrame(frame)
    }
    // A scrub that lands repeatedly on the same frame still bumps the epoch.
    store.getState().setCurrentFrame(99)
    store.getState().setCurrentFrame(99)

    expect(store.getState().currentFrame).toBe(99)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('does not write for play/pause either', async () => {
    const storage = fakeStorage()
    const store = await loadStore(storage)

    store.getState().play()
    store.getState().pause()
    store.getState().togglePlayPause()

    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('writes once when a preference actually changes', async () => {
    const storage = fakeStorage()
    const store = await loadStore(storage)

    store.getState().setZoom(12)
    expect(storage.setItem).toHaveBeenCalledTimes(1)

    const [key, value] = storage.setItem.mock.calls[0] as [string, string]
    expect(key).toBe('myeditor-playback')
    expect(JSON.parse(value)).toEqual({
      state: {
        zoom: 12,
        volume: 1,
        muted: false,
        playbackRate: 1,
        loop: false,
        snapEnabled: true,
      },
      version: 0,
    })
  })

  it('writes for each preference and no more', async () => {
    const storage = fakeStorage()
    const store = await loadStore(storage)

    store.getState().toggleMute()
    store.getState().setVolume(0.5)
    store.getState().toggleSnap()
    store.getState().toggleLoop()
    store.getState().setPlaybackRate(2)

    expect(storage.setItem).toHaveBeenCalledTimes(5)

    // A no-op set writes nothing: the clamped value is already current.
    storage.setItem.mockClear()
    store.getState().setVolume(0.5)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('restores preferences written by the previous implementation', async () => {
    // Same key and same `{ state, version }` envelope zustand's persist wrote,
    // so nobody loses their zoom or their mute across this change.
    const storage = fakeStorage({
      'myeditor-playback': JSON.stringify({
        state: { zoom: 9, volume: 0.25, muted: true, playbackRate: 2, loop: true, snapEnabled: false },
        version: 0,
      }),
    })
    const store = await loadStore(storage)

    expect(store.getState()).toMatchObject({
      zoom: 9,
      volume: 0.25,
      muted: true,
      playbackRate: 2,
      loop: true,
      snapEnabled: false,
      // Never persisted: where the playhead was belongs to the composition.
      currentFrame: 0,
      isPlaying: false,
    })
  })

  it('falls back to defaults on unreadable or partial stored state', async () => {
    const store = await loadStore(
      fakeStorage({ 'myeditor-playback': '{ not json' }),
    )
    expect(store.getState().zoom).toBe(4)

    const partial = await loadStore(
      fakeStorage({
        'myeditor-playback': JSON.stringify({ state: { zoom: 7, muted: 'yes' }, version: 0 }),
      }),
    )
    expect(partial.getState().zoom).toBe(7)
    // Wrong type for the field — ignored rather than trusted.
    expect(partial.getState().muted).toBe(false)
  })
})
