/**
 * The one font loader (PV-P4a), shared by the main thread and the export
 * worker. DOM-free: the caller passes the FontFaceSet (`document.fonts` or the
 * worker's `self.fonts`) and FontFace is looked up at call time, so importing
 * this module touches nothing global. Never throws: a face that fails to load
 * is removed and reported, and text falls back to the generic family.
 */
import { fontFaceFamily, fontFileUrl, getFont, type FontDef, type FontFile } from './registry'
import type { Project } from '../types'

export interface EnsureFontsOptions {
  /** Directory holding `<id>/<file>`, ending in '/'. Absolute inside a worker (see resolveFontBaseUrl). */
  baseUrl: string
  /** `document.fonts` on the main thread, `self.fonts` in a worker. */
  fonts: FontFaceSet
  /** Test seam; defaults to `globalThis.FontFace`. */
  FontFaceCtor?: typeof FontFace
  /** Called once per face that failed to load and once per unknown id. */
  onWarning?: (message: string) => void
}

/** Per FontFaceSet: face key → load promise (true = loaded). */
const faceLoads = new WeakMap<FontFaceSet, Map<string, Promise<boolean>>>()
const warnedIds = new Set<string>()
const listeners = new Set<() => void>()
let epoch = 0

/** Increments each time a call to ensureFonts finished loading at least one new face. */
export function fontsEpoch(): number {
  return epoch
}

/** Subscribe to epoch changes; returns the unsubscribe function. */
export function onFontsChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Ensure a trailing slash; resolve against `pageHref` when given (a worker needs an absolute URL). */
export function resolveFontBaseUrl(baseUrl: string, pageHref?: string): string {
  const withSlash = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  if (!pageHref) return withSlash
  try {
    return new URL(withSlash, pageHref).href
  } catch {
    return withSlash
  }
}

/**
 * Bundled font ids the project's text clips name: sorted, unique (PV-P4a-2).
 *
 * This is what the export worker preloads and what the preview warms on, so it
 * has to see a font named ANYWHERE in the document — including inside a compound
 * (PV-P1, `clip.compound.project`), because a title in a nested project paints
 * into the same exported frame. The read is structural, so it works whether or
 * not the field is populated.
 *
 * The depth bound is 4, matching `MAX_COMPOUND_DEPTH`: a project cannot nest
 * deeper than the engine allows, and a bound is what stops a hand-edited
 * document with a cycle in it from recursing forever. A font deeper than that is
 * unreachable in practice, and is reported by neither side.
 */
export function collectFontIds(project: Pick<Project, 'clips'>): string[] {
  const ids = new Set<string>()
  const walk = (p: Pick<Project, 'clips'>, depth: number): void => {
    for (const clip of Object.values(p.clips).flat()) {
      if (clip.type === 'text' && typeof clip.fontId === 'string' && clip.fontId) ids.add(clip.fontId)
      const nested = (clip as { compound?: { project?: Pick<Project, 'clips'> } }).compound?.project
      if (nested && depth < 4) walk(nested, depth + 1)
    }
  }
  walk(project, 0)
  return [...ids].sort()
}

export async function ensureFonts(ids: readonly string[], opts: EnsureFontsOptions): Promise<void> {
  const Ctor = opts.FontFaceCtor ?? (globalThis as { FontFace?: typeof FontFace }).FontFace
  const warn = opts.onWarning ?? (() => {})
  if (!Ctor) {
    warn('FontFace is not available here; bundled fonts fall back to system fonts')
    return
  }
  let cache = faceLoads.get(opts.fonts)
  if (!cache) {
    cache = new Map()
    faceLoads.set(opts.fonts, cache)
  }
  const created: Promise<boolean>[] = []
  const all: Promise<boolean>[] = []
  for (const id of new Set(ids)) {
    const def = getFont(id)
    if (!def) {
      if (!warnedIds.has(id)) {
        warnedIds.add(id)
        warn(`Unknown font id "${id}"; the clip's fallback family is used`)
      }
      continue
    }
    for (const file of def.files) {
      const url = fontFileUrl(opts.baseUrl, def, file)
      const key = `${fontFaceFamily(def)}|${file.weight}|${file.style}|${url}`
      let load = cache.get(key)
      if (!load) {
        load = loadFace(Ctor, opts.fonts, def, file, url, warn)
        cache.set(key, load)
        created.push(load)
      }
      all.push(load)
    }
  }
  const results = await Promise.all(created)
  await Promise.all(all)
  if (results.some(Boolean)) {
    epoch++
    for (const listener of [...listeners]) listener()
  }
}

async function loadFace(
  Ctor: typeof FontFace,
  fonts: FontFaceSet,
  def: FontDef,
  file: FontFile,
  url: string,
  warn: (message: string) => void,
): Promise<boolean> {
  let face: FontFace | undefined
  try {
    face = new Ctor(fontFaceFamily(def), `url("${url}") format("woff2")`, {
      weight: String(file.weight),
      style: file.style,
    })
    fonts.add(face)
    await face.load()
    return true
  } catch (err) {
    if (face) fonts.delete(face)
    const reason = err instanceof Error ? err.message : String(err)
    warn(`Font "${def.family}" ${file.weight} ${file.style} failed to load from ${url} (${reason}); using the system fallback`)
    return false
  }
}
