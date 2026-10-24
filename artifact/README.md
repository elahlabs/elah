# Elah artifact app

One page that previews, edits and exports an Elah video. It is the page a Claude Code plugin publishes as a
claude.ai artifact, and it also runs from any static host. Contract and layout: `docs/plans/PLAN-CLAUDE-PLUGIN-ARTIFACT.md`
in the workspace (sections 3 and 4).

```
node artifact/build.mjs          # from the elah repo root; installs nothing
node artifact/serve.mjs 4410     # local test server (port 4400-4499)
npx --no tsc -p artifact --noEmit
```

`dist/` (git-ignored) is the publishable folder: `index.html`, `elah-artifact.js`, `chunks/`, `workers/`, `fonts/`,
`MANIFEST.json` (every file but itself, relative paths, with sizes). The build fails above 250 files or 16 MB per file.

## Input

`elah-input.json` beside the page (or an inline `<script type="application/json" id="elah-input">`, which wins):

```json
{ "format": "elah-input", "version": 1, "title": "...", "source": { "kind": "spec" | "html" | "project", ... } }
```

- `spec`: a VideoSpec (or authored spec) run through `buildVideo`.
- `html`: `html`, `css`, `durationSeconds`, `stage`, `fps`. Validated, measured in a hidden host in this page, converted
  with `sceneToClip`; the scene's clips are lifted onto the timeline so Edit can animate them.
- `project`: a `.elah.json` Project document, read with `readProjectDocument`.

Every spec issue or refusal is listed verbatim in the Issues panel (with Copy issues).

## How it is built

- esbuild (from the repo's node_modules), ESM with splitting, minified; `@elah/*` aliased to `packages/*/src`, `@/` to
  `apps/web` (the playground's Animate panel, curve drawer and timeline controls are reused unchanged, read-only).
  React is pinned to the root copy (apps/web has its own React 19).
- Workers: core spawns three workers with `new Worker(new URL('./X.ts', import.meta.url))`, which esbuild does not
  follow. They are built as standalone ESM into `dist/workers/` and a load-time rewrite points each spawn at
  `workers/X.js` next to the entry (from the entry or from `chunks/`). All same-origin.
- Fonts: `packages/core/fonts` is copied to `dist/fonts/<id>/`; the page loads every family with `ensureFonts` from
  `<page>/fonts/` and passes the same absolute base to `exportVideo({ fonts: { baseUrl } })`.
- CSS: Tailwind (CLI from node_modules) over the reused sources plus the editor token bridge from
  `apps/web/styles/globals.css`, inlined into `index.html`. Dark is the Elah look; light is a variant.
- Save: `window.claude.downloads.save({ filename, data: Blob })` when present, else an `<a download>`.

## Samples

`samples/<name>/elah-input.json`, served at `http://localhost:<port>/<name>/` (default `promo`): `promo` (spec),
`title-card` (html), `project` (regenerate with `node artifact/samples/make-project-sample.mjs`), `refused` (issues panel).
