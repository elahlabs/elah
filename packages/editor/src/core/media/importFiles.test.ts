import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMediaLibraryStore } from './store'
import {
  importFiles,
  makeImageThumbnail,
  makeVideoThumbnail,
  probeAudio,
  probeImage,
  probeVideo,
} from './importFiles'

type MediaEventHandler = (() => void) | null

interface StubMediaElement {
  tagName: string
  preload: string
  muted: boolean
  src: string
  duration: number
  videoWidth: number
  videoHeight: number
  currentTime: number
  readyState: number
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  _handlers: Record<string, MediaEventHandler>
  _emit: (event: string) => void
}

interface StubImageElement {
  tagName: string
  src: string
  naturalWidth: number
  naturalHeight: number
  onload: (() => void) | null
  onerror: (() => void) | null
}

interface StubCanvasContext {
  drawImage: ReturnType<typeof vi.fn>
}

interface StubCanvasElement {
  tagName: string
  width: number
  height: number
  getContext: ReturnType<typeof vi.fn>
  toDataURL: ReturnType<typeof vi.fn>
  _ctx: StubCanvasContext
}

function createStubMediaElement(tag: 'video' | 'audio'): StubMediaElement {
  const handlers: Record<string, MediaEventHandler> = {}

  return {
    tagName: tag.toUpperCase(),
    preload: '',
    muted: false,
    src: '',
    duration: 12.5,
    videoWidth: 1920,
    videoHeight: 1080,
    currentTime: 0,
    readyState: 0,
    addEventListener: vi.fn((event: string, handler: () => void) => {
      handlers[event] = handler
    }),
    removeEventListener: vi.fn((event: string) => {
      handlers[event] = null
    }),
    _handlers: handlers,
    _emit(event: string) {
      handlers[event]?.()
    },
  }
}

function createStubImage(): StubImageElement {
  return {
    tagName: 'IMG',
    src: '',
    naturalWidth: 800,
    naturalHeight: 600,
    onload: null,
    onerror: null,
  }
}

function createStubCanvas(): StubCanvasElement {
  const ctx: StubCanvasContext = {
    drawImage: vi.fn(),
  }

  return {
    tagName: 'CANVAS',
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => 'data:image/jpeg;base64,thumb'),
    _ctx: ctx,
  }
}

function makeFile(
  name: string,
  type: string,
  size = 1024,
  lastModified = 1_700_000_000_000,
): File {
  return new File(['x'.repeat(size)], name, { type, lastModified })
}

describe('importFiles', () => {
  let createdMedia: StubMediaElement[]
  let createdImages: StubImageElement[]
  let createdCanvases: StubCanvasElement[]
  let objectUrlCounter: number

  beforeEach(() => {
    createdMedia = []
    createdImages = []
    createdCanvases = []
    objectUrlCounter = 0

    useMediaLibraryStore.setState({ assets: {}, order: [] })

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => {
        objectUrlCounter += 1
        return `blob:mock-${objectUrlCounter}`
      }),
    })

    vi.stubGlobal('document', {
      createElement: vi.fn((tag: string) => {
        if (tag === 'video' || tag === 'audio') {
          const el = createStubMediaElement(tag)
          createdMedia.push(el)
          return el
        }

        if (tag === 'img') {
          const img = createStubImage()
          createdImages.push(img)
          return img
        }

        if (tag === 'canvas') {
          const canvas = createStubCanvas()
          createdCanvases.push(canvas)
          return canvas
        }

        throw new Error(`Unexpected createElement tag: ${tag}`)
      }),
    })

    vi.stubGlobal('HTMLMediaElement', {
      HAVE_CURRENT_DATA: 2,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('registers video and image assets in the media library store', async () => {
    const importPromise = importFiles([
      makeFile('clip.mp4', 'video/mp4'),
      makeFile('photo.png', 'image/png'),
    ])

    await Promise.resolve()

    const videoEl = createdMedia.find((el) => el.tagName === 'VIDEO')
    expect(videoEl).toBeDefined()
    videoEl!._emit('loadedmetadata')

    await Promise.resolve()

    const imageEl = createdImages[0]
    expect(imageEl).toBeDefined()
    imageEl.onload?.()

    const result = await importPromise

    expect(result.imported).toHaveLength(2)
    expect(result.skipped).toEqual([])
    expect(result.imported[0]).toMatchObject({
      kind: 'video',
      name: 'clip.mp4',
      durationSec: 12.5,
      width: 1920,
      height: 1080,
      src: 'blob:mock-1',
      lastModified: 1_700_000_000_000,
    })
    expect(result.imported[1]).toMatchObject({
      kind: 'image',
      name: 'photo.png',
      durationSec: 0,
      width: 800,
      height: 600,
      src: 'blob:mock-2',
      lastModified: 1_700_000_000_000,
    })

    const store = useMediaLibraryStore.getState()
    expect(Object.keys(store.assets)).toHaveLength(2)
    expect(store.order).toEqual([result.imported[0].id, result.imported[1].id])
  })

  it('skips unsupported mime types with a warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await importFiles([makeFile('notes.txt', 'text/plain')])

    expect(result.imported).toEqual([])
    expect(result.skipped).toEqual([
      expect.objectContaining({
        reason: 'unsupported',
        file: expect.objectContaining({ name: 'notes.txt' }),
      }),
    ])
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipping unsupported file type'),
    )
  })

  it('imports audio assets without thumbnails', async () => {
    const importPromise = importFiles([makeFile('voice.mp3', 'audio/mpeg')])

    await Promise.resolve()

    const audioEl = createdMedia.find((el) => el.tagName === 'AUDIO')
    audioEl!._emit('loadedmetadata')

    const result = await importPromise

    expect(result.imported).toHaveLength(1)
    expect(result.imported[0]).toMatchObject({
      kind: 'audio',
      name: 'voice.mp3',
      durationSec: 12.5,
    })
    expect(result.imported[0].thumbnailUrl).toBeUndefined()
  })

  it('updates thumbnailUrl asynchronously for video imports', async () => {
    const importPromise = importFiles([makeFile('clip.mp4', 'video/mp4')])

    await Promise.resolve()
    createdMedia[0]._emit('loadedmetadata')

    const result = await importPromise
    expect(result.imported[0].thumbnailUrl).toBeUndefined()
    expect(createdMedia).toHaveLength(2)

    const thumbVideo = createdMedia[1]
    thumbVideo._emit('loadedmetadata')
    await Promise.resolve()
    thumbVideo._emit('seeked')

    await vi.waitFor(() => {
      const updated = useMediaLibraryStore.getState().getAsset(result.imported[0].id)
      expect(updated?.thumbnailUrl).toBe('data:image/jpeg;base64,thumb')
    })
  })

  it('imports multiple files in parallel', async () => {
    const importPromise = importFiles([
      makeFile('a.mp4', 'video/mp4'),
      makeFile('b.mp3', 'audio/mpeg'),
      makeFile('c.png', 'image/png'),
    ])

    await Promise.resolve()

    for (const el of createdMedia) {
      el._emit('loadedmetadata')
    }
    for (const img of createdImages) {
      img.onload?.()
    }

    const result = await importPromise

    expect(result.imported).toHaveLength(3)
    expect(result.skipped).toEqual([])
    expect(result.imported.map((asset) => asset.kind)).toEqual(['video', 'audio', 'image'])
  })

  it('skips duplicate files within the same import batch', async () => {
    const file = makeFile('clip.mp4', 'video/mp4')
    const importPromise = importFiles([file, file])

    await Promise.resolve()
    createdMedia[0]._emit('loadedmetadata')

    const result = await importPromise

    expect(result.imported).toHaveLength(1)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]).toMatchObject({
      reason: 'duplicate',
      file,
    })
    expect(result.skipped[0].existingAssetId).toBeUndefined()
    expect(Object.keys(useMediaLibraryStore.getState().assets)).toHaveLength(1)
  })

  it('skips files that match an asset already in the store', async () => {
    const file = makeFile('clip.mp4', 'video/mp4', 1024, 1_700_000_000_001)
    const importPromise = importFiles([file])

    await Promise.resolve()
    createdMedia[0]._emit('loadedmetadata')

    const first = await importPromise
    expect(first.imported).toHaveLength(1)

    const duplicatePromise = importFiles([makeFile('clip.mp4', 'video/mp4', 1024, 1_700_000_000_001)])

    const duplicate = await duplicatePromise

    expect(duplicate.imported).toEqual([])
    expect(duplicate.skipped).toHaveLength(1)
    expect(duplicate.skipped[0]).toMatchObject({
      reason: 'duplicate',
      existingAssetId: first.imported[0].id,
    })
    expect(Object.keys(useMediaLibraryStore.getState().assets)).toHaveLength(1)
  })
})

describe('media probe helpers', () => {
  beforeEach(() => {
    useMediaLibraryStore.setState({ assets: {}, order: [] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('probeVideo resolves metadata from loadedmetadata', async () => {
    const el = createStubMediaElement('video')

    vi.stubGlobal('document', {
      createElement: vi.fn(() => el),
    })

    const probePromise = probeVideo('blob:test-video')
    el._emit('loadedmetadata')

    await expect(probePromise).resolves.toEqual({
      durationSec: 12.5,
      width: 1920,
      height: 1080,
    })
  })

  it('probeAudio resolves duration from loadedmetadata', async () => {
    const el = createStubMediaElement('audio')

    vi.stubGlobal('document', {
      createElement: vi.fn(() => el),
    })

    const probePromise = probeAudio('blob:test-audio')
    el._emit('loadedmetadata')

    await expect(probePromise).resolves.toEqual({
      durationSec: 12.5,
    })
  })

  it('probeImage resolves dimensions from onload', async () => {
    const img = createStubImage()

    vi.stubGlobal('document', {
      createElement: vi.fn(() => img),
    })

    const probePromise = probeImage('blob:test-image')
    img.onload?.()

    await expect(probePromise).resolves.toEqual({
      durationSec: 0,
      width: 800,
      height: 600,
    })
  })
})

describe('thumbnail helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('makeVideoThumbnail draws a scaled frame after seeked', async () => {
    const el = createStubMediaElement('video')

    vi.stubGlobal('document', {
      createElement: vi.fn((tag: string) => {
        if (tag === 'video') return el
        return createStubCanvas()
      }),
    })

    vi.stubGlobal('HTMLMediaElement', {
      HAVE_CURRENT_DATA: 2,
    })

    const thumbPromise = makeVideoThumbnail('blob:test-video', 240)
    el._emit('loadedmetadata')
    await Promise.resolve()
    el._emit('seeked')

    await expect(thumbPromise).resolves.toBe('data:image/jpeg;base64,thumb')
  })

  it('makeImageThumbnail draws a scaled image on load', async () => {
    const img = createStubImage()

    vi.stubGlobal('document', {
      createElement: vi.fn((tag: string) => {
        if (tag === 'img') return img
        return createStubCanvas()
      }),
    })

    const thumbPromise = makeImageThumbnail('blob:test-image', 240)
    img.onload?.()

    await expect(thumbPromise).resolves.toBe('data:image/jpeg;base64,thumb')
  })
})
