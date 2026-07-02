/**
 * lazyExport — lazy-loaded export module.
 *
 * Defers loading exportVideo and its dependencies (including mediabunny)
 * until explicitly requested. Bundlers like Vite will code-split this
 * into a separate chunk, keeping the main bundle lean.
 */

import type { Project } from '../types'
import type { ExportOptions, ExportProgress } from './types'

/**
 * Dynamically import and call exportVideo.
 *
 * Usage:
 * ```ts
 * const blob = await lazyExportVideo(project, options)
 * ```
 *
 * This keeps mediabunny out of the main bundle.
 */
export async function lazyExportVideo(project: Project, options?: ExportOptions): Promise<Blob> {
  const { exportVideo: actualExport } = await import(
    /* webpackChunkName: "editor-export" */
    './exportVideo'
  )
  return actualExport(project, options)
}

export type { ExportOptions, ExportProgress, ExportVideoCodec, ExportAudioCodec } from './types'
