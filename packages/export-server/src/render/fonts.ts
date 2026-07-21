/**
 * Font registration and family substitution.
 *
 * Node/Skia has no browser font stack: `@napi-rs/canvas` will happily accept
 * `'sans-serif'` as a font name and then silently draw nothing (or fall back
 * to whatever the OS's default happens to be), because there is no browser
 * user-agent stylesheet mapping CSS generics to installed fonts. Text clips
 * carry whatever `fontFamily` the editor stored — often a raw CSS stack like
 * `'Inter, sans-serif'` — so every family requested by a Scene has to be
 * resolved to one Skia actually knows about before `computeTextLayout` (core,
 * unmodified) measures it and the compositor draws it. That resolution is
 * this module's entire job; it registers nothing on its own initiative and
 * changes no core code — it only sits between a Scene's text elements and the
 * canvas font name that gets asked for.
 */

import { GlobalFonts } from '@napi-rs/canvas'

import type { FontSpec } from '../types'
import { ExportServerError } from '../errors'

/**
 * CSS generic families. These are never real installed-font names, so an
 * exact-match lookup against `available` would only succeed by accident (a
 * font literally named "serif"), which is not a case worth trusting — treat
 * every one of them as unresolved and route through the fallback.
 */
const GENERIC_FAMILIES = new Set(['sans-serif', 'serif', 'monospace', 'system-ui', 'cursive', 'fantasy'])

/**
 * The default `computeTextLayout` (packages/core/src/renderer/gpu/layers/textLayout.ts)
 * applies when a text clip omits `fontFamily`. Not imported from core — core
 * has zero dependents in this package's module graph by design (Scene-only
 * rule) — so this is intentionally the same literal, not a re-export.
 */
const DEFAULT_FONT_FAMILY = 'sans-serif'

export interface FontRegistryOptions {
  fonts?: FontSpec[]
  /** Family used whenever a requested family cannot be resolved. */
  fallbackFamily?: string
  /**
   * Families to treat as already available, bypassing `GlobalFonts.families`.
   * Exists so `substitute`'s logic is unit-testable without a real font file
   * or a populated (and host-dependent) system font registry. Defaults to
   * `GlobalFonts.families` mapped to family names.
   */
  availableFamilies?: string[]
}

export interface FontRegistry {
  /** The family Skia should actually be asked for. Never returns undefined. */
  substitute(family: string | undefined): string
  /** Requested families that had to be substituted — surfaced as ExportResult.warnings. */
  readonly missing: readonly string[]
  /** Families Skia currently knows about (registered + system). */
  readonly available: readonly string[]
}

/** Strips a stack entry's surrounding whitespace and wrapping quotes: `' "Inter"'` -> `'Inter'`. */
function cleanFamilyName(raw: string): string {
  return raw.trim().replace(/^['"]|['"]$/g, '')
}

/**
 * Registers every `FontSpec` with Skia's process-global font registry, then
 * returns a resolver that maps any family a text clip might request onto one
 * Skia can actually render.
 *
 * Registration happens eagerly, in `fonts` order, and fails loudly: a font
 * path that doesn't load is `ExportServerError('FONT_LOAD_FAILED', ...)`
 * naming the path, never a silent skip. A font that quietly failed to
 * register would make every clip using it fall back to some other family
 * with no error and no warning — a silently wrong export, which is strictly
 * worse than a failed one.
 */
export function createFontRegistry(options: FontRegistryOptions): FontRegistry {
  const { fonts = [], fallbackFamily, availableFamilies } = options

  const registeredFamilies: string[] = []
  for (const spec of fonts) {
    let ok: boolean
    try {
      // registerFromPath returns a FontKey on success, null on failure — never
      // a boolean. `!!` turns "was a key returned" into the yes/no this loop
      // actually needs.
      ok = !!GlobalFonts.registerFromPath(spec.path, spec.family)
    } catch (err) {
      throw new ExportServerError(
        'FONT_LOAD_FAILED',
        `Failed to register font at '${spec.path}'` +
          `${spec.family ? ` as '${spec.family}'` : ''}: ${(err as Error).message}`,
      )
    }
    if (!ok) {
      throw new ExportServerError(
        'FONT_LOAD_FAILED',
        `Failed to register font at '${spec.path}'` +
          `${spec.family ? ` as '${spec.family}'` : ''} — @napi-rs/canvas rejected the file.`,
      )
    }
    if (spec.family) registeredFamilies.push(spec.family)
  }

  const available: string[] =
    availableFamilies ?? GlobalFonts.families.map((entry: { family: string }) => entry.family)
  const availableLower = new Set(available.map((family: string) => family.toLowerCase()))
  const missing = new Set<string>()

  function isKnown(family: string): boolean {
    return availableLower.has(family.toLowerCase())
  }

  /**
   * `fallbackFamily` if it was given and is actually available, else the
   * first font this registry registered, else the first family Skia (or the
   * injected list) reports, else the literal CSS default — that last case
   * only fires when nothing was registered and `available` is empty, i.e. a
   * misconfigured host with no system fonts at all.
   */
  function resolveFallback(): string {
    if (fallbackFamily && isKnown(fallbackFamily)) return fallbackFamily
    if (registeredFamilies.length > 0) return registeredFamilies[0]
    if (available.length > 0) return available[0]
    return DEFAULT_FONT_FAMILY
  }

  function substitute(family: string | undefined): string {
    const requested = family ?? DEFAULT_FONT_FAMILY

    // A CSS font stack ('Inter, sans-serif') and a single family both flow
    // through this same loop — a bare family is just a one-entry stack.
    const stack = requested
      .split(',')
      .map(cleanFamilyName)
      .filter(entry => entry.length > 0)
    const candidates = stack.length > 0 ? stack : [requested]

    for (const candidate of candidates) {
      if (!GENERIC_FAMILIES.has(candidate.toLowerCase()) && isKnown(candidate)) {
        return candidate
      }
    }

    // Nothing in the stack resolved: record the request as given (not the
    // cleaned/split form) so warnings read back the same string the caller
    // saw on the Scene's text element, then fall back.
    missing.add(requested)
    return resolveFallback()
  }

  return {
    substitute,
    get missing() {
      return Array.from(missing)
    },
    get available() {
      return available
    },
  }
}
