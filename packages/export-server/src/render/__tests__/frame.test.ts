import { describe, expect, it } from 'vitest'
import { createCanvas } from '@napi-rs/canvas'
import { computeTextLayout, type Scene, type ActiveTransition } from '@elah/core'

import { FrameCompositor, type FrameSources } from '../frame'
import type { FontRegistry } from '../fonts'
import type { DecodedFrame } from '../../types'

/** A FontRegistry stand-in — this suite never registers a real font file. */
function fakeFonts(): FontRegistry {
  return {
    substitute: family => family ?? 'sans-serif',
    missing: [],
    available: ['sans-serif'],
  }
}

function emptySources(): FrameSources {
  return { video: new Map(), images: new Map() }
}

/** Base fields every ActiveClip needs, so each test only spells out what it varies. */
function clipBase(id: string, zIndex: number) {
  return { id, trackId: 't', name: id, sourceFrame: 0, opacity: 1, zIndex }
}

function baseScene(overrides: Partial<Scene>): Scene {
  return {
    frame: 0,
    fps: 30,
    stage: { width: 200, height: 100 },
    videos: [],
    audios: [],
    texts: [],
    images: [],
    shapes: [],
    freehand: [],
    transitions: [],
    ...overrides,
  }
}

function pixelAt(data: Uint8ClampedArray, width: number, x: number, y: number): [number, number, number, number] {
  const i = (y * width + x) * 4
  return [data[i], data[i + 1], data[i + 2], data[i + 3]]
}

function solidFrame(size: number, r: number, g: number, b: number): DecodedFrame {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  }
  return { data, width: size, height: size, displayWidth: size, displayHeight: size }
}

describe('FrameCompositor', () => {
  it('draws a shape and a text clip, leaving the rest of the stage as the opaque black background', () => {
    const width = 200
    const height = 100
    const compositor = new FrameCompositor({ width, height, fonts: fakeFonts() })

    const scene = baseScene({
      stage: { width, height },
      shapes: [
        {
          ...clipBase('shape-1', 0),
          type: 'shape',
          shapeKind: 'rect',
          shapeFill: '#ff0000',
          shapeStroke: '#000000',
          shapeStrokeWidth: 0,
          transform: { x: 0.15, y: 0.5, scale: 0.2, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
        },
      ],
      texts: [
        {
          ...clipBase('text-1', 1),
          type: 'text',
          content: 'Hi',
          color: '#00ff00',
          fontSize: 40,
        },
      ],
    })

    const pixels = compositor.render(scene, emptySources())

    // Shape: center (0.15,0.5) on a 200x100 stage -> (30,50); shortSide=100,
    // scale=0.2 -> half=10, so the filled square spans (20,40)-(40,60).
    expect(pixelAt(pixels, width, 30, 50)).toEqual([255, 0, 0, 255])

    // Text: reuse computeTextLayout (the same function the compositor calls)
    // to find the glyph bounding box instead of hard-coding pixel metrics that
    // depend on the host's font rasterizer.
    const measureCanvas = createCanvas(1, 1)
    const layout = computeTextLayout(
      measureCanvas.getContext('2d') as unknown as Pick<CanvasRenderingContext2D, 'font' | 'measureText'>,
      { content: 'Hi', transform: undefined, fontSize: 40 },
      { width, height },
    )
    let foundGreen = false
    const x0 = Math.max(0, Math.floor(layout.box.x))
    const x1 = Math.min(width - 1, Math.ceil(layout.box.x + layout.box.width))
    const y0 = Math.max(0, Math.floor(layout.box.y))
    const y1 = Math.min(height - 1, Math.ceil(layout.box.y + layout.box.height))
    for (let y = y0; y <= y1 && !foundGreen; y++) {
      for (let x = x0; x <= x1; x++) {
        const [r, g, b] = pixelAt(pixels, width, x, y)
        if (g > 100 && r < 100 && b < 100) {
          foundGreen = true
          break
        }
      }
    }
    expect(foundGreen).toBe(true)

    // Far corner untouched by either clip stays the opaque black background.
    expect(pixelAt(pixels, width, width - 1, height - 1)).toEqual([0, 0, 0, 255])
  })

  it('draws the higher zIndex shape on top when two shapes fully overlap', () => {
    const width = 100
    const height = 100
    const compositor = new FrameCompositor({ width, height, fonts: fakeFonts() })

    const transform = { x: 0.5, y: 0.5, scale: 0.6, rotation: 0, anchor: { x: 0.5, y: 0.5 } }
    const scene = baseScene({
      stage: { width, height },
      shapes: [
        // Listed out of zIndex order on purpose — the compositor must sort, not
        // trust array order.
        {
          ...clipBase('blue-on-top', 1),
          type: 'shape',
          shapeKind: 'rect',
          shapeFill: '#0000ff',
          shapeStroke: '#000000',
          shapeStrokeWidth: 0,
          transform,
        },
        {
          ...clipBase('red-underneath', 0),
          type: 'shape',
          shapeKind: 'rect',
          shapeFill: '#ff0000',
          shapeStroke: '#000000',
          shapeStrokeWidth: 0,
          transform,
        },
      ],
    })

    const pixels = compositor.render(scene, emptySources())
    expect(pixelAt(pixels, width, 50, 50)).toEqual([0, 0, 255, 255])
  })

  it('freezes a video transition snapshot on its first frame and releases it once the transition ends', () => {
    const width = 4
    const height = 4
    const compositor = new FrameCompositor({ width, height, fonts: fakeFonts() })

    const videoClip = {
      ...clipBase('v1', 0),
      type: 'video' as const,
      src: 'v1.mp4',
      volume: 1,
      opacity: 0, // resolver convention: outgoing clip is invisible, snapshot carries it
    }

    const transition: ActiveTransition = {
      id: 't1',
      kind: 'fade',
      t: 0, // alpha = 1 - t = 1, fully opaque snapshot
      fromClipId: 'v1',
      toClipId: 'v2',
    }

    // Frame A: transition starts. The decoded frame is solid red — expect it
    // to be captured and painted.
    const frameA = baseScene({
      stage: { width, height },
      videos: [videoClip],
      transitions: [transition],
    })
    const pixelsA = compositor.render(frameA, {
      video: new Map([['v1', solidFrame(width, 255, 0, 0)]]),
      images: new Map(),
    })
    expect(pixelAt(pixelsA, width, 1, 1)).toEqual([255, 0, 0, 255])

    // Frame B: same transition still active, but the decoder has moved on to a
    // different (green) source frame. The snapshot must stay frozen at red —
    // it is captured once, not every frame.
    const frameB = baseScene({
      stage: { width, height },
      videos: [videoClip],
      transitions: [transition],
    })
    const pixelsB = compositor.render(frameB, {
      video: new Map([['v1', solidFrame(width, 0, 255, 0)]]),
      images: new Map(),
    })
    expect(pixelAt(pixelsB, width, 1, 1)).toEqual([255, 0, 0, 255])

    // Frame C: the transition has ended (no longer in scene.transitions) — its
    // snapshot must be released.
    const frameC = baseScene({ stage: { width, height }, videos: [videoClip] })
    compositor.render(frameC, { video: new Map([['v1', solidFrame(width, 0, 255, 0)]]), images: new Map() })

    // Frame D: the same transition id reappears with a fresh (blue) source
    // frame. If the frame-B snapshot had leaked past release, this would still
    // read back red; a proper release lets it capture blue instead.
    const frameD = baseScene({
      stage: { width, height },
      videos: [videoClip],
      transitions: [transition],
    })
    const pixelsD = compositor.render(frameD, {
      video: new Map([['v1', solidFrame(width, 0, 0, 255)]]),
      images: new Map(),
    })
    expect(pixelAt(pixelsD, width, 1, 1)).toEqual([0, 0, 255, 255])

    compositor.dispose()
  })
})
