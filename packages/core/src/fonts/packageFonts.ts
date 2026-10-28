/**
 * Where this package's own copies of the bundled fonts live (CONV-5).
 *
 * The package ships every registry family under `fonts/<id>/` at its root,
 * beside `dist/`, with each family's `OFL.txt`. A page that imports the
 * package unbundled (from a CDN such as jsDelivr, or a native-ESM dev server)
 * passes `packageFontsBaseUrl()` as `fonts: { baseUrl }` to load them from the
 * package instead of from `/fonts/` on its own host:
 *
 * ```ts
 * await exportVideo(project, { fonts: { baseUrl: packageFontsBaseUrl() } })
 * ```
 *
 * Opt-in: `DEFAULT_FONT_BASE_URL` (`/fonts/`) stays the default. Bundled hosts
 * (webpack, Turbopack, Vite) should keep serving the files themselves, because
 * a bundler rewrites `import.meta.url` to a source or chunk location.
 *
 * Not reachable from `engine.ts`: this is the fonts module that reads
 * `import.meta`, which Metro and Hermes reject.
 */

/** From `dist/fonts/packageFonts.js` (and `src/fonts/packageFonts.ts`) up to the package root's `fonts/`. */
const PACKAGE_FONTS_RELATIVE = '../../fonts/'

/**
 * The package fonts directory for a module at `moduleUrl` (this file's built
 * location). Exported for tests; a parameter rather than `import.meta.url`
 * inline so bundlers do not mistake it for an asset reference to a directory.
 */
export function packageFontsBaseUrlFrom(moduleUrl: string): string {
  return new URL(PACKAGE_FONTS_RELATIVE, moduleUrl).href
}

/** Absolute URL of this package's `fonts/` directory, ending in '/'. */
export function packageFontsBaseUrl(): string {
  return packageFontsBaseUrlFrom(import.meta.url)
}
