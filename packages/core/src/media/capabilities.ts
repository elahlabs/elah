/**
 * Media decode/encode capability probes (PV-P8a).
 *
 * DOM-free by import — no `import` of a DOM lib module — so this file loads
 * identically in a window, in a module worker, and in the node vitest
 * environment. It only ever *reads* ambient globals (`ImageDecoder`,
 * `VideoEncoder`, `OffscreenCanvas`), which are absent under node and present
 * under a real browser/worker scope; every branch here tolerates absence
 * rather than assuming a browser.
 *
 * These numbers are recorded once, before any rendering code exists (preview
 * decode is PV-P8b, export encode is PV-P8c): whatever the browser answers,
 * the sequence clip design stands either way (a first-frame fallback covers
 * every "unsupported" case) — see the ticket's Risks for how each answer is
 * read.
 */

/** Animated/sequence image formats this build ever probes. */
export type ProbedImageType = 'image/gif' | 'image/webp' | 'image/png' | 'image/avif'

export const PROBED_IMAGE_TYPES: ReadonlyArray<ProbedImageType> = [
  'image/gif',
  'image/webp',
  'image/png',
  'image/avif',
]

export interface ImageDecodeSupport {
  /** Whether this scope exposes a WebCodecs `ImageDecoder`. */
  imageDecoder: boolean
  /** `ImageDecoder.isTypeSupported(type)` per type; all `false` when `imageDecoder` is `false`; a throw counts as `false`. */
  types: Record<ProbedImageType, boolean>
}

export interface WebmAlphaSupport {
  videoEncoder: boolean
  /** `VideoEncoder.isConfigSupported({ ..., alpha: 'keep' }).supported`, the raw WebCodecs answer. */
  rawAlphaKeep: boolean
  /** `mediabunny.canEncodeVideo('vp9', { ..., alpha: 'keep' })` — mediabunny may answer differently; it runs a second encoder for alpha itself. */
  mediabunnyAlphaKeep: boolean
  /** Encode 10 frames with alpha 'keep' into WebM, decode frame 0 with `CanvasSink({ alpha: true })`, and read a pixel outside the drawn square. */
  roundTrip: 'alpha' | 'opaque' | 'failed' | 'skipped'
  /** `canBeTransparent()` of the decoded track; `null` when the round trip never reached it. */
  canBeTransparent: boolean | null
  detail?: string
}

export interface ScopeCapabilities {
  image: ImageDecodeSupport
  webmAlpha: WebmAlphaSupport
}

/** The shape this probe needs from a real `ImageDecoder` constructor. */
interface ImageDecoderLike {
  isTypeSupported(type: string): Promise<boolean>
}

/**
 * Whether this scope can decode each probed image type with WebCodecs.
 *
 * `scope` defaults to `globalThis` so a caller in a window or a worker needs
 * no argument; a test passes a plain object standing in for the constructor.
 * Detection is presence, not a `typeof … === 'function'` check, because the
 * real global's `ImageDecoder` is a constructor (a function) and a test
 * double naming only `isTypeSupported` is not — both must count as "present"
 * for this to be testable outside a real WebCodecs scope.
 */
export async function probeImageDecode(
  scope: { ImageDecoder?: ImageDecoderLike } = globalThis as { ImageDecoder?: ImageDecoderLike },
): Promise<ImageDecodeSupport> {
  const decoder = scope.ImageDecoder
  const imageDecoder = decoder !== undefined && decoder !== null
  const types: Record<ProbedImageType, boolean> = {
    'image/gif': false,
    'image/webp': false,
    'image/png': false,
    'image/avif': false,
  }
  if (imageDecoder) {
    for (const type of PROBED_IMAGE_TYPES) {
      try {
        types[type] = await decoder!.isTypeSupported(type)
      } catch {
        types[type] = false
      }
    }
  }
  return { imageDecoder, types }
}

const PROBE_WIDTH = 320
const PROBE_HEIGHT = 180
const PROBE_BITRATE = 1_000_000
const PROBE_FRAME_COUNT = 10

/**
 * Whether this scope can encode AND round-trip a transparent WebM.
 *
 * Two different questions, both worth keeping apart: the raw WebCodecs
 * `VideoEncoder.isConfigSupported` answer (`rawAlphaKeep`) can differ from
 * mediabunny's own (`mediabunnyAlphaKeep`), because mediabunny runs a second
 * encoder itself for alpha. Neither says whether a DECODER anywhere in this
 * pipeline can get the alpha back out — that is what `roundTrip` measures, by
 * actually encoding a small transparent square and reading a pixel outside it.
 *
 * `VideoEncoder`/`OffscreenCanvas` are checked BEFORE importing mediabunny, so
 * a scope with neither (this repo's node test environment, most workers
 * without WebCodecs) never pays for loading the encoder.
 */
export async function probeWebmAlpha(): Promise<WebmAlphaSupport> {
  if (typeof VideoEncoder === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    return {
      videoEncoder: false,
      rawAlphaKeep: false,
      mediabunnyAlphaKeep: false,
      roundTrip: 'skipped',
      canBeTransparent: null,
    }
  }

  let rawAlphaKeep = false
  try {
    const support = await VideoEncoder.isConfigSupported({
      codec: 'vp09.00.10.08',
      width: PROBE_WIDTH,
      height: PROBE_HEIGHT,
      bitrate: PROBE_BITRATE,
      alpha: 'keep',
    })
    rawAlphaKeep = support.supported === true
  } catch {
    rawAlphaKeep = false
  }

  try {
    const mb = await import('mediabunny')
    const mediabunnyAlphaKeep = await mb.canEncodeVideo('vp9', {
      width: PROBE_WIDTH,
      height: PROBE_HEIGHT,
      bitrate: PROBE_BITRATE,
      alpha: 'keep',
    })

    const canvas = new OffscreenCanvas(PROBE_WIDTH, PROBE_HEIGHT)
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D
    const target = new mb.BufferTarget()
    const output = new mb.Output({ format: new mb.WebMOutputFormat(), target })
    const source = new mb.CanvasSource(canvas, { codec: 'vp9', bitrate: PROBE_BITRATE, alpha: 'keep' })
    output.addVideoTrack(source)
    await output.start()
    for (let i = 0; i < PROBE_FRAME_COUNT; i++) {
      ctx.clearRect(0, 0, PROBE_WIDTH, PROBE_HEIGHT)
      ctx.fillStyle = '#ff0000'
      ctx.fillRect(80, 45, 160, 90)
      await source.add(i / 10, 1 / 10)
    }
    await output.finalize()

    const input = new mb.Input({
      formats: mb.ALL_FORMATS,
      source: new mb.BlobSource(new Blob([target.buffer!])),
    })
    const track = await input.getPrimaryVideoTrack()
    const canBeTransparent = await track!.canBeTransparent()
    const wrapped = await new mb.CanvasSink(track!, { alpha: true }).getCanvas(0.05)
    const alphaCtx = wrapped!.canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
    // Pixel (8, 8): outside the 160x90 square drawn at (80, 45).
    const alpha = alphaCtx.getImageData(8, 8, 1, 1).data[3]!
    input.dispose()

    return {
      videoEncoder: true,
      rawAlphaKeep,
      mediabunnyAlphaKeep,
      roundTrip: alpha < 128 ? 'alpha' : 'opaque',
      canBeTransparent,
    }
  } catch (err) {
    return {
      videoEncoder: true,
      rawAlphaKeep,
      mediabunnyAlphaKeep: false,
      roundTrip: 'failed',
      canBeTransparent: null,
      detail: String(err),
    }
  }
}

/** Both probes for the calling scope (window or worker). */
export async function probeScope(): Promise<ScopeCapabilities> {
  return { image: await probeImageDecode(), webmAlpha: await probeWebmAlpha() }
}
