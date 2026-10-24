import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Isolated from `importFiles.test.ts` so the rest of that suite keeps exercising
// the real determination module.
vi.mock('./hasAudio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hasAudio')>()
  return { ...actual, determineAssetHasAudio: vi.fn(async () => true) }
})

import { beginImportUrl, importUrl } from './importFiles'
import { determineAssetHasAudio } from './hasAudio'
import { mediaLibraryStore } from './store'

const determineMock = vi.mocked(determineAssetHasAudio)

/** Media element stub whose metadata never arrives — the probe is irrelevant here. */
function stubMediaElement() {
  return {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    duration: 0,
    videoWidth: 0,
    videoHeight: 0,
    set src(_v: string) {},
  }
}

describe('import paths start the audio-track determination', () => {
  beforeEach(() => {
    mediaLibraryStore.setState({ assets: {}, order: [] })
    determineMock.mockClear()
    vi.stubGlobal('document', {
      createElement: vi.fn((tag: string) => {
        if (tag === 'video' || tag === 'audio') return stubMediaElement()
        throw new Error(`Unexpected createElement tag: ${tag}`)
      }),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('beginImportUrl kicks off the determination for a video without waiting on metadata', async () => {
    // The gallery inserts the returned placeholder in the same click, so the
    // determination has to be in flight by the time this resolves — not queued
    // behind the (slow, CDN-bound) metadata probe.
    const asset = await beginImportUrl('https://cdn.example.com/lipsync.mp4', { kind: 'video' })

    expect(determineMock).toHaveBeenCalledWith(asset.id)
    expect(mediaLibraryStore.getState().getAsset(asset.id)?.status).toBe('pending')
  })

  it('beginImportUrl does not probe audio-only or image assets', async () => {
    await beginImportUrl('https://cdn.example.com/voice.mp3', { kind: 'audio' })

    expect(determineMock).not.toHaveBeenCalled()
  })

  it('importUrl kicks off the determination once the asset is registered', async () => {
    let created: ReturnType<typeof stubMediaElement> | null = null
    vi.stubGlobal('document', {
      createElement: vi.fn((tag: string) => {
        if (tag !== 'video') throw new Error(`Unexpected createElement tag: ${tag}`)
        created = stubMediaElement()
        created.duration = 4
        return created
      }),
    })

    const importPromise = importUrl('https://cdn.example.com/clip.mp4', { kind: 'video' })
    await vi.waitFor(() => expect(created).not.toBeNull())
    // Fire the 'loadedmetadata' listener the probe registered.
    const onLoaded = created!.addEventListener.mock.calls.find(
      (call) => call[0] === 'loadedmetadata',
    )![1] as () => void
    onLoaded()

    const asset = await importPromise
    expect(determineMock).toHaveBeenCalledWith(asset.id)
  })
})
