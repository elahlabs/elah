/**
 * @elah/export-server — public API surface.
 *
 * The only entry point a consumer needs: `exportProject(project, options)`.
 * Everything else in this package (plan.ts, probe.ts, ffmpeg/*, render/*) is
 * an implementation detail reached only through this function, so nothing
 * else is exported here.
 */

export { exportProject } from './exportProject'

export type {
  ExportProjectOptions,
  ExportResult,
  ExportProgress,
  ExportPhase,
  FontSpec,
  OutputValidation,
  Scene,
} from './types'

export { ExportServerError } from './errors'
export type { ExportErrorCode, ExportServerErrorOptions } from './errors'
