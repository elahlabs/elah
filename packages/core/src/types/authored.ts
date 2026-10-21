/**
 * Provenance records for generated graphics (EG-P1).
 *
 * These types are deliberately LOOSE and structural. `types/index.ts` is the
 * base type module; the precise spec types (`SpecComponent`, `AuthoredSpec`,
 * `MotionStyle`) live in `spec/`, which itself imports `Clip` and `Project`
 * from `types/`. Importing them here would make the base module depend on the
 * frozen spec layer (`types -> spec -> types`). Spec-side code casts at the
 * seam instead (`as unknown as ClipComponentInstance['input']`).
 *
 * Nothing here is ever read by the renderer and none of it bumps
 * PROJECT_VERSION: every field that uses these types is optional.
 */

/** A JSON-safe plain object. */
export interface JsonObject {
  [key: string]: unknown
}

/** Which component made a compound clip, and everything needed to make it again. */
export interface ClipComponentInstance {
  v: 1
  /** A `ComponentName`, stored as a string so an unknown name from a newer build still reads. */
  name: string
  /** The `SpecComponent` the author wrote, with defaults resolved (duration clamped/defaulted, energy resolved). JSON-safe. */
  input: JsonObject
  /** The seed `expandComponents` actually used, so a re-expansion is byte-identical. */
  seed: number
  /** The resolved MotionStyle in force at expansion. */
  style: { energy: string; camera: boolean; ambient: string; transition: string }
  /** The design tokens the piece declared. Absent when it declared none. */
  design?: { colors?: unknown[]; fonts?: unknown[] }
}

/**
 * An SVG the assistant drew or found for a piece, stored as a hosted file (SVG-2).
 * A later build or scene revise of the same piece fetches `url` instead of asking
 * the model for the graphic again.
 */
export interface AuthoredAsset {
  /** The name the plan gave the asset (at most 40 characters). */
  name: string
  /** The hosted SVG file. `https://` only, at most 2,000 characters. */
  url: string
  source: 'drawn' | 'found'
  /** Who made a found icon, and under which licence. */
  credit?: { provider: string; set: string; name: string; licence: string; pageUrl: string; author?: string }
  /** The model that drew it. */
  model?: string
}

/** The authored document a generated piece came from, kept so later phases can re-expand it. */
export interface ProjectAuthored {
  v: 1
  /** The `AuthoredSpec` as written (components unexpanded). JSON-safe. */
  spec: JsonObject
  /** The director's treatment, when there was one. JSON-safe. */
  treatment?: unknown
  /** The expansion seed actually used. */
  seed: number
  model?: string
  /** ISO-8601 time the piece was laid. */
  createdAt: string
  /** SVGs stored for this piece (SVG-2). At most 12; optional, so `v` stays 1. */
  assets?: AuthoredAsset[]
}

/**
 * The source a `write_scene` compound was converted from (CMP-EDIT-3). `html` is stored AFTER icon resolution
 * (inline svg), so a re-convert needs no network. Never read by the renderer; never bumps PROJECT_VERSION.
 */
export interface ClipSceneSource {
  v: 1
  html: string
  css: string
  name: string
  /** Seconds, as passed to the tool. */
  duration: number
}
