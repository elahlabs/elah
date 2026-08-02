# @elah/editor — Next.js Example

A standalone Next.js (App Router) app showcasing the **production editor** built on
[`@elah/editor`](https://www.npmjs.com/package/@elah/editor), installed **from npm** —
this app is intentionally *outside* the monorepo workspace so it consumes the published
package, not the local `packages/editor` source.

## Run

```bash
cd examples/next
npm install
npm run dev      # http://localhost:4001
```

## What it demonstrates

- `<EditorProvider>` wiring with video / audio / text tracks
- `<Preview>` (WebGL2) driven by a mediabunny demuxer backend
- `<Timeline>`, `<AssetPanel>`, `<ElementsPanel>`
- A custom properties panel (`TextClipProperties`) using the editor's zustand stores
- MP4 export via `lazyExportVideo` with a progress / cancel modal

## Key integration points

| Concern | File |
| --- | --- |
| Mount (client-only) | [`app/page.tsx`](app/page.tsx) — `dynamic(..., { ssr: false })` |
| SDK stylesheets (all **three**) | [`app/layout.tsx`](app/layout.tsx) |
| Editor composition | [`components/ProductionEditor.tsx`](components/ProductionEditor.tsx) |
| Bundler config | [`next.config.mjs`](next.config.mjs) — `transpilePackages` |
| Theming (`--elah-*` overrides) | [`app/globals.css`](app/globals.css) |

## Notes

- The editor is browser-only (Canvas / WebGL2 / Web Audio / Workers), hence `ssr: false`.
- **Three stylesheets are required** — `@elah/timeline/styles.css`,
  `@elah/editor/styles.css`, and `@elah/editor/styles/tokens.css`. Each package compiles
  its own, so they don't contain each other's classes.
- **`lucide-react` is a peer dependency** of `@elah/editor` and is declared explicitly in
  `package.json`. npm auto-installs peers; pnpm and yarn do not.
- The video decoder is wired with the SDK's built-in
  `createDefaultDemuxerFactory()` — no need to install or import `mediabunny`
  yourself; `@elah/core` depends on it directly.
- `transpilePackages` must include the `@elah/*` packages and `mediabunny` so
  Next/Turbopack transpiles their ESM and resolves the export Web Worker that
  `@elah/core` spawns.

## Building a custom UI?

Start from [`../minimal`](../minimal) — the same integration in ~130 readable lines. The
complete API reference with copy-paste recipes is
[`docs/ai/ELAH_FOR_AI_AGENTS.md`](../../docs/ai/ELAH_FOR_AI_AGENTS.md).
