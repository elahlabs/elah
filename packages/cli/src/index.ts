export { buildProject as build } from './lib/build-project'
export type { BuildProjectArgs, BuildProjectResult, BuildSummary } from './lib/build-project'

export { exportProject } from './lib/export-project'
export type { ExportProjectArgs, ExportProjectResult } from './lib/export-project'

export { createRenderSession, CODECS } from './lib/render-session'
export type {
  RenderSession,
  RenderSessionArgs,
  RenderJobOptions,
  RenderCallbacks,
  VideoCodec,
} from './lib/render-session'

export { CONTAINERS, resolveOutputFormat } from './lib/format'
export type { Container, OutputFormat } from './lib/format'

export { ENCODER_CHOICES } from './lib/ffmpeg/select'
export type { EncoderChoice } from './lib/ffmpeg/select'
export { locateFfmpeg, MIN_FFMPEG_VERSION } from './lib/ffmpeg/locate'
export type { FfmpegBinary, LocateFfmpegOptions } from './lib/ffmpeg/locate'

export { CliError, CliError as ElahError } from './lib/errors'

export { validateSpec, specToProject } from './lib/spec'
export type { BuildSpec, SpecClip, SpecMediaClip, SpecTextClip, ProbedAsset } from './lib/spec'

export { probeMedia } from './lib/probe'
export type { MediaInfo } from './lib/probe'

export type { ProgressPayload } from './lib/server'

export { startServe, Semaphore } from './lib/serve'
export type { ServeOptions, ServeHandle } from './lib/serve'

export type { Project } from '@elah/core'
