export { exportVideo } from './exportVideo'
export type { ExportOptions, ExportProgress, ExportVideoCodec, ExportAudioCodec, ExportContainer, FrameSink } from './types'
export { ExportCapabilityError } from './exportErrors'
export { zipStore, crc32 } from './zipStore'
export type { ZipFile } from './zipStore'
export { renderVariants } from './renderVariants'
export type { VariantRow, VariantProgress, RenderVariantsOptions, VariantResult } from './renderVariants'
export { resolveExportRange } from './range'
export type { ExportRangeMode, ExportFrameRange } from './range'
export {
  resolveExportFormat,
  webmAlphaExportSupported,
  ensureTransparencyGate,
  clearWebmAlphaExportCache,
  probeVideoCodecSupport,
  ensureVideoCodecSupport,
  offeredVideoCodecs,
  EXPORT_OFFER_HEVC,
} from './capabilities'
export type { IsConfigSupported, VideoConfigProbeInput } from './capabilities'
export { GIF_DEFAULT_MAX_FPS, GIF_DEFAULT_MAX_SHORT_EDGE, GIF_MAX_FRAMES } from './gifEncode'
export type { ResolvedExportFormat, AlphaGateDeps, AlphaGateResult } from './capabilities'
export { renderAudioMix } from './exportVideo'
export { detectExportSupport, EXPORT_UNSUPPORTED_MESSAGE } from './browserSupport'
export type { ExportSupport, ExportSupportEnv, ExportSupportFeature } from './browserSupport'
export { sourceAwareFetch, sourceAwareAudioResolver } from './sources'
export type { AssetBlobFetcher } from './sources'
export {
  fullMixRange,
  audibleSpan,
  scheduleAudioClip,
  gainAutomation,
  applyGainEvents,
  isAudioTrackAudible,
  hasAudibleSolo,
  isClipAudioAudible,
  GAIN_EPSILON,
} from './audioMix'
export type {
  AudioMixRange,
  GainEvent,
  AudioClipSchedule,
  GainParamLike,
  GainAutomationAncestry,
} from './audioMix'
