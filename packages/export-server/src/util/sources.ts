/**
 * sources.ts — clip `src` -> something ffmpeg and mediabunny can open.
 *
 * Ported (not imported) from packages/cli/src/lib/project-io.ts
 * (`isRemoteUrl`, `resolveMediaSource`): @elah/cli is off limits to this
 * package, and this is the one seam where the two exporters must agree byte
 * for byte — a project JSON that renders one way through `elah export` must
 * resolve its clip sources identically here, or "matches the editor" stops
 * being true before a single frame is decoded.
 *
 * `blob:`/`data:` are the one divergence from the CLI: those srcs only exist
 * inside a live browser session (an in-memory MediaSource/object URL), so a
 * project exported from the browser without first materializing its assets
 * to files has nothing on disk for ffmpeg or mediabunny to open. The CLI never
 * has to consider them because it only ever loads projects that were already
 * saved as files; a server export can receive either, so this module is the
 * one that has to say so.
 */

import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ExportServerError } from '../errors'

/** True for http(s) sources, which ffmpeg and mediabunny's UrlSource open directly. */
export function isRemoteUrl(src: string): boolean {
  return /^https?:\/\//.test(src)
}

/** True for sources that only exist inside a browser tab and have no on-disk form. */
function isInMemoryUrl(src: string): boolean {
  return /^(blob|data):/.test(src)
}

/** Resolve a clip src against the project directory. Remote URLs pass through unchanged. */
export function resolveSource(src: string, baseDir: string): string {
  if (isInMemoryUrl(src)) {
    throw new ExportServerError(
      'SOURCE_UNSUPPORTED',
      `Clip src '${src}' is an in-memory browser source (blob:/data:) and has no on-disk form ` +
        'for ffmpeg or mediabunny to open. Materialize browser assets to files (and rewrite the ' +
        'project\'s clip srcs to point at them) before exporting on the server.',
    )
  }
  if (isRemoteUrl(src)) return src
  if (src.startsWith('file://')) return fileURLToPath(src)
  return isAbsolute(src) ? src : resolve(baseDir, src)
}
