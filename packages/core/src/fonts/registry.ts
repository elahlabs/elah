/**
 * Bundled OFL font families (PV-P4a). Pure data: no DOM, safe in the export
 * worker. Files live at `<baseUrl><id>/<file>` (the host application serves
 * them). Faces are registered under `elah-<id>` so they can never
 * collide with a legacy `fontFamily` string.
 */

export type FontCategory = 'sans' | 'serif' | 'display' | 'mono' | 'handwriting'

export interface FontFile {
  /** CSS weight of this static instance, 100..900. */
  weight: number
  style: 'normal' | 'italic'
  /** File name inside `<baseUrl><id>/`. */
  file: string
}

export interface FontDef {
  /** Stable kebab-case id stored in documents (`Clip.fontId`). Never rename one. */
  id: string
  /** Display name for pickers. */
  family: string
  category: FontCategory
  files: readonly FontFile[]
  license: 'OFL'
}

/** Where the host application serves the files; hosts may pass another base. */
export const DEFAULT_FONT_BASE_URL = '/fonts/'

export const FONT_CATEGORY_LABELS: Record<FontCategory, string> = {
  sans: 'Sans',
  serif: 'Serif',
  display: 'Display',
  mono: 'Monospace',
  handwriting: 'Handwriting',
}

const GENERIC: Record<FontCategory, string> = {
  sans: 'sans-serif',
  serif: 'serif',
  display: 'sans-serif',
  mono: 'monospace',
  handwriting: 'cursive',
}

const f = (weight: number, style: 'normal' | 'italic' = 'normal'): FontFile => ({
  weight,
  style,
  file: `latin-${weight}-${style}.woff2`,
})

export const FONT_REGISTRY: readonly FontDef[] = [
  { id: 'inter', family: 'Inter', category: 'sans', license: 'OFL', files: [f(400), f(400, 'italic'), f(700), f(900)] },
  { id: 'montserrat', family: 'Montserrat', category: 'sans', license: 'OFL', files: [f(400), f(400, 'italic'), f(700), f(900)] },
  { id: 'poppins', family: 'Poppins', category: 'sans', license: 'OFL', files: [f(400), f(400, 'italic'), f(600), f(800)] },
  { id: 'space-grotesk', family: 'Space Grotesk', category: 'sans', license: 'OFL', files: [f(400), f(700)] },
  { id: 'playfair-display', family: 'Playfair Display', category: 'serif', license: 'OFL', files: [f(400), f(400, 'italic'), f(700), f(900)] },
  { id: 'dm-serif-display', family: 'DM Serif Display', category: 'serif', license: 'OFL', files: [f(400), f(400, 'italic')] },
  { id: 'bebas-neue', family: 'Bebas Neue', category: 'display', license: 'OFL', files: [f(400)] },
  { id: 'anton', family: 'Anton', category: 'display', license: 'OFL', files: [f(400)] },
  { id: 'oswald', family: 'Oswald', category: 'display', license: 'OFL', files: [f(400), f(700)] },
  { id: 'archivo-black', family: 'Archivo Black', category: 'display', license: 'OFL', files: [f(400)] },
  { id: 'roboto-mono', family: 'Roboto Mono', category: 'mono', license: 'OFL', files: [f(400), f(700)] },
  { id: 'caveat', family: 'Caveat', category: 'handwriting', license: 'OFL', files: [f(400), f(700)] },
]

const BY_ID = new Map(FONT_REGISTRY.map((def) => [def.id, def]))

export function getFont(id: string): FontDef | undefined {
  return typeof id === 'string' ? BY_ID.get(id) : undefined
}

/** The private family name a face is registered under. */
export function fontFaceFamily(def: FontDef): string {
  return `elah-${def.id}`
}

/** CSS family list for a bundled font, with its generic fallback; undefined for an unknown id. */
export function fontFamilyCss(id: string): string | undefined {
  const def = getFont(id)
  return def ? `"${fontFaceFamily(def)}", ${GENERIC[def.category]}` : undefined
}

export function fontFileUrl(baseUrl: string, def: FontDef, file: FontFile): string {
  return `${baseUrl}${def.id}/${file.file}`
}

/** Sorted, unique weights the family ships. */
export function fontWeights(def: FontDef): number[] {
  return [...new Set(def.files.map((x) => x.weight))].sort((a, b) => a - b)
}

export function fontHasItalic(def: FontDef): boolean {
  return def.files.some((x) => x.style === 'italic')
}
