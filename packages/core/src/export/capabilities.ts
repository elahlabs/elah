/**
 * Export container/codec matrix and the WebM transparency gate (PV-P9a-1).
 *
 * `resolveExportFormat` is a pure, synchronous validation the caller runs
 * BEFORE spawning the export worker — a bad container/codec/transparency
 * combination rejects the export immediately, with no asset fetch, no GPU
 * renderer and no worker spun up.
 *
 * `webmAlphaExportSupported`/`ensureTransparencyGate` answer the one question
 * a codec-config check cannot: whether THIS runtime can actually carry a
 * transparent frame through encode → decode, not merely whether an encoder
 * claims to accept an `alpha: 'keep'` config. PV-P8a's own `probeWebmAlpha`
 * already does the real thing — it encodes a transparent square into WebM via
 * mediabunny and decodes it back with a real decoder, so `roundTrip` reports
 * what a DECODER saw, not what an encoder's config check claimed. Reusing it
 * here (rather than a second, ExportWorker-local reimplementation) keeps that
 * round trip single-sourced; see PV-CONTRACTS: "unsupported browser
 * measurements stay not run/unsupported, never passed by mocked tests" — a
 * `supported: true` config is never, by itself, treated as capability.
 */

import { probeWebmAlpha, type WebmAlphaSupport } from '../media/capabilities'
import { ExportCapabilityError } from './exportErrors'
import type { ExportAudioCodec, ExportContainer, ExportVideoCodec } from './types'

export type { ExportContainer }

export interface ResolvedExportFormat {
  container: ExportContainer
  videoCodec: ExportVideoCodec
  audioCodec: ExportAudioCodec
  mimeType: string
}

const CONTAINER_VIDEO_CODECS: Record<ExportContainer, ReadonlyArray<ExportVideoCodec>> = {
  mp4: ['avc', 'hevc', 'av1'],
  webm: ['vp9', 'vp8', 'av1'],
  'png-sequence': [],
  gif: [],
}

const CONTAINER_AUDIO_CODECS: Record<ExportContainer, ReadonlyArray<ExportAudioCodec>> = {
  mp4: ['aac'],
  webm: ['opus'],
  'png-sequence': [],
  gif: [],
}

const CONTAINER_DEFAULT_VIDEO_CODEC: Record<ExportContainer, ExportVideoCodec | null> = {
  mp4: 'avc',
  webm: 'vp9',
  'png-sequence': null,
  gif: null,
}

const CONTAINER_DEFAULT_AUDIO_CODEC: Record<ExportContainer, ExportAudioCodec | null> = {
  mp4: 'aac',
  webm: 'opus',
  'png-sequence': null,
  gif: null,
}

const CONTAINER_MIME_TYPE: Record<ExportContainer, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  // PV-P9a-2 gives PNG sequences their own transport (a ZIP of frames); typed
  // here so ExportOptions.container is already the full future union, but
  // resolveExportFormat below rejects it until that ticket lands.
  'png-sequence': 'application/zip',
  gif: 'image/gif',
}

/**
 * Resolves and validates a requested container/codec/transparency
 * combination, defaulting unset codecs per the container (MP4 → AVC/AAC,
 * WebM → VP9/Opus). Throws `ExportCapabilityError` — never returns an
 * invalid combination:
 *
 * - `container: 'png-sequence'` always rejects (PV-P9a-2 owns it).
 * - `transparent: true` with `container: 'mp4'` (the default) always rejects,
 *   suggesting WebM or PNG — MP4/AVC cannot carry an alpha channel.
 * - An explicit `videoCodec`/`audioCodec` not valid for the resolved
 *   container rejects (e.g. `videoCodec: 'vp9'` with the default `'mp4'`
 *   container).
 *
 * A project with none of `container`/`transparent`/explicit codecs set
 * resolves to exactly today's MP4/AVC/AAC — every existing caller and export
 * is unaffected.
 */
export function resolveExportFormat(options: {
  container?: ExportContainer
  videoCodec?: ExportVideoCodec
  audioCodec?: ExportAudioCodec
  audioBitrate?: number
  transparent?: boolean
}): ResolvedExportFormat {
  const container: ExportContainer = options.container ?? 'mp4'

  // REN-5: a GIF has no soundtrack, no video codec, and no alpha we offer.
  // Placeholder codecs (like the PNG path's) keep the return type total;
  // nothing reads them for a GIF.
  if (container === 'gif') {
    if (options.videoCodec) {
      throw new ExportCapabilityError('A GIF has no video codec to select. Leave videoCodec unset.')
    }
    if (options.audioCodec || options.audioBitrate !== undefined) {
      throw new ExportCapabilityError('A GIF has no audio. Leave audioCodec and audioBitrate unset, or export MP4/WebM to keep sound.')
    }
    if (options.transparent) {
      throw new ExportCapabilityError('GIF transparency is not supported. Export WebM with transparency or a PNG sequence.')
    }
    return { container, videoCodec: 'avc', audioCodec: 'aac', mimeType: CONTAINER_MIME_TYPE.gif }
  }

  if (container === 'png-sequence') {
    throw new ExportCapabilityError('PNG sequence support requires PV-P9a-2.')
  }

  if (options.transparent && container === 'mp4') {
    throw new ExportCapabilityError(
      'MP4 cannot carry transparency. Export as WebM with transparency turned on, or as a PNG sequence.',
    )
  }

  const videoCodec = options.videoCodec ?? CONTAINER_DEFAULT_VIDEO_CODEC[container]!
  if (!CONTAINER_VIDEO_CODECS[container].includes(videoCodec)) {
    throw new ExportCapabilityError(
      `Video codec "${videoCodec}" is not valid in a ${container.toUpperCase()} container. Use ${CONTAINER_VIDEO_CODECS[container].join(' or ')}.`,
    )
  }

  if (options.transparent && videoCodec !== 'vp9' && videoCodec !== 'vp8') {
    throw new ExportCapabilityError(
      `Transparent export is only verified for VP9 and VP8 WebM, not ${videoCodec.toUpperCase()}. Choose VP9, or turn transparency off.`,
    )
  }

  const audioCodec = options.audioCodec ?? CONTAINER_DEFAULT_AUDIO_CODEC[container]!
  if (!CONTAINER_AUDIO_CODECS[container].includes(audioCodec)) {
    throw new ExportCapabilityError(
      `Audio codec "${audioCodec}" is not valid in a ${container.toUpperCase()} container. Use ${CONTAINER_AUDIO_CODECS[container].join(' or ')}.`,
    )
  }

  return { container, videoCodec, audioCodec, mimeType: CONTAINER_MIME_TYPE[container] }
}

export interface AlphaGateDeps {
  /** Injectable for tests; defaults to PV-P8a's real `probeWebmAlpha`. */
  probe?: () => Promise<WebmAlphaSupport>
}

export interface AlphaGateResult {
  supported: boolean
  support: WebmAlphaSupport
}

/**
 * One cached answer per cache key (default: the video codec), for the
 * runtime's REAL probe only — an injected test probe always runs fresh, so
 * two tests never share a stale answer. A caller that wants a forced re-probe
 * (e.g. after a browser update mid-session, or a test) uses
 * `clearWebmAlphaExportCache`.
 */
const alphaGateCache = new Map<string, Promise<AlphaGateResult>>()

/**
 * Whether this runtime can carry a transparent WebM all the way through a
 * real decode, per PV-P8a's own encode→decode round trip. `supported` is
 * `true` only when `support.roundTrip === 'alpha'` — a `rawAlphaKeep`/
 * `mediabunnyAlphaKeep` config answer of `true` is not enough by itself (the
 * round trip can still come back `'opaque'`; PV-P8a's own probe measured
 * exactly that gap between what an encoder claims and what a decoder gets
 * back). `roundTrip: 'skipped'` (no `VideoEncoder`/`OffscreenCanvas` at all)
 * and `'failed'` both count as unsupported.
 */
export async function webmAlphaExportSupported(deps: AlphaGateDeps = {}, cacheKey = 'vp9'): Promise<AlphaGateResult> {
  if (deps.probe) {
    const support = await deps.probe()
    return { supported: support.roundTrip === 'alpha', support }
  }
  let cached = alphaGateCache.get(cacheKey)
  if (!cached) {
    cached = probeWebmAlpha().then((support) => ({ supported: support.roundTrip === 'alpha', support }))
    alphaGateCache.set(cacheKey, cached)
  }
  return cached
}

/** Clears the real-probe cache (tests, or a deliberate re-probe). */
export function clearWebmAlphaExportCache(): void {
  alphaGateCache.clear()
}

/**
 * Rejects an export that asks for transparency this runtime cannot actually
 * deliver. A no-op for every opaque export (the common case never pays for a
 * probe) and for MP4 (already rejected by `resolveExportFormat` before this
 * ever runs).
 */
export async function ensureTransparencyGate(
  format: ResolvedExportFormat,
  transparent: boolean | undefined,
  deps: AlphaGateDeps = {},
): Promise<void> {
  if (!transparent) return
  if (format.container !== 'webm') return
  const { supported, support } = await webmAlphaExportSupported(deps, format.videoCodec)
  if (!supported) {
    throw new ExportCapabilityError(
      `This browser cannot reliably encode a transparent WebM (round trip: ${support.roundTrip}). ` +
        'Turn transparency off to export an opaque WebM, or wait for PNG sequence support (PV-P9a-2).',
    )
  }
}

// ---------------------------------------------------------------------------
// REN-5: HEVC / AV1 encoder support gate
// ---------------------------------------------------------------------------

/**
 * Whether the product UI offers HEVC (REN-5). OFF pending the founder's
 * licensing decision (PLAN-PROGRAMMATIC-PARITY section 6): HEVC encoders are
 * hardware-backed and patent-pooled. The export path itself still accepts
 * `videoCodec: 'hevc'` from a programmatic caller where the browser's own
 * `isConfigSupported` says yes; this constant only controls what a menu lists.
 */
export const EXPORT_OFFER_HEVC = false

/** Codec strings probed per codec: a generous level so a 4K frame is not a false negative. */
const PROBE_CODEC_STRING: Record<ExportVideoCodec, string> = {
  avc: 'avc1.640033',
  hevc: 'hvc1.1.6.L153.B0',
  av1: 'av01.0.12M.08',
  vp9: 'vp09.00.50.08',
  vp8: 'vp8',
}

export interface VideoConfigProbeInput {
  codec: string
  width: number
  height: number
  bitrate?: number
  framerate?: number
}
export type IsConfigSupported = (config: VideoConfigProbeInput) => Promise<{ supported?: boolean }>

function defaultIsConfigSupported(): IsConfigSupported | null {
  const enc = (globalThis as { VideoEncoder?: { isConfigSupported?: IsConfigSupported } }).VideoEncoder
  return enc && typeof enc.isConfigSupported === 'function' ? (c) => enc.isConfigSupported!(c) : null
}

/**
 * Asks the encoder, per codec, whether it can encode `width`x`height`.
 * `isConfigSupported` is injectable so Node tests cover both answers; with no
 * `VideoEncoder` at all every codec is unsupported. A rejecting probe counts
 * as unsupported, never as a pass.
 */
export async function probeVideoCodecSupport(
  codecs: ReadonlyArray<ExportVideoCodec>,
  width: number,
  height: number,
  isConfigSupported: IsConfigSupported | null = defaultIsConfigSupported(),
): Promise<Record<ExportVideoCodec, boolean>> {
  const result = { avc: false, hevc: false, av1: false, vp9: false, vp8: false } as Record<ExportVideoCodec, boolean>
  if (!isConfigSupported) return result
  await Promise.all(
    codecs.map(async (codec) => {
      try {
        const r = await isConfigSupported({ codec: PROBE_CODEC_STRING[codec], width, height, bitrate: 8_000_000, framerate: 30 })
        result[codec] = r.supported === true
      } catch {
        result[codec] = false
      }
    }),
  )
  return result
}

/**
 * The codecs a UI should list for `container`: AVC/VP9/VP8 as before, AV1
 * only where the probe says yes, HEVC only where the probe says yes AND
 * `offerHevc` (default `EXPORT_OFFER_HEVC`, off). The container's default
 * codec is always included so a menu is never empty.
 */
export function offeredVideoCodecs(
  container: ExportContainer,
  support: Partial<Record<ExportVideoCodec, boolean>>,
  offerHevc: boolean = EXPORT_OFFER_HEVC,
): ExportVideoCodec[] {
  const base = CONTAINER_VIDEO_CODECS[container]
  const def = CONTAINER_DEFAULT_VIDEO_CODEC[container]
  return base.filter((c) => {
    if (c === def) return true
    if (c === 'hevc') return offerHevc && support.hevc === true
    if (c === 'av1') return support.av1 === true
    return true
  })
}

/**
 * Rejects an HEVC or AV1 export this browser's encoder cannot do, naming the
 * codec. A no-op for every other codec (the common case never probes) and for
 * GIF. Run by `exportVideo` before any asset fetch or worker.
 */
export async function ensureVideoCodecSupport(
  format: ResolvedExportFormat,
  width: number,
  height: number,
  isConfigSupported?: IsConfigSupported | null,
): Promise<void> {
  if (format.container === 'gif') return
  if (format.videoCodec !== 'hevc' && format.videoCodec !== 'av1') return
  const probe = isConfigSupported === undefined ? defaultIsConfigSupported() : isConfigSupported
  const support = await probeVideoCodecSupport([format.videoCodec], width, height, probe)
  if (!support[format.videoCodec]) {
    const name = format.videoCodec === 'hevc' ? 'HEVC (H.265)' : 'AV1'
    throw new ExportCapabilityError(
      `This browser cannot encode ${name} at ${width}x${height}. Export H.264 MP4 or VP9 WebM instead.`,
    )
  }
}
