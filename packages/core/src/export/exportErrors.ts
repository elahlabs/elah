/**
 * Thrown when a project needs something this browser's export path cannot
 * do (EDX-P3: effects need WebGL2 inside the export worker). `code` survives
 * the worker boundary, so the main thread re-creates this class and the UI
 * can tell it apart from a crash.
 */
export class ExportCapabilityError extends Error {
  readonly code = 'capability' as const
  constructor(message: string) {
    super(message)
    this.name = 'ExportCapabilityError'
  }
}

export const WEBGL2_EXPORT_MESSAGE =
  'This project uses effects, and exporting them needs WebGL2 inside a background worker, which this browser does not provide. Try a recent Chrome, Edge or Firefox, or turn the effects off to export without them.'
