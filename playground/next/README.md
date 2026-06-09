# @elah/editor — Next.js Playground

A standalone Next.js (App Router) app showcasing the **production editor** built on
[`@elah/editor`](https://www.npmjs.com/package/@elah/editor), installed **from npm** —
this app is intentionally *outside* the monorepo workspace so it consumes the published
package, not the local `packages/editor` source.

## Run

```bash
cd playground/next
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
| Editor composition | [`components/ProductionEditor.tsx`](components/ProductionEditor.tsx) |
| Bundler config | [`next.config.mjs`](next.config.mjs) — `transpilePackages` |

## Notes

- The editor is browser-only (Canvas / Web Audio / Workers), hence `ssr: false`.
- The video decoder is wired with the SDK's built-in
  `createDefaultDemuxerFactory()` — no need to install or import `mediabunny`
  yourself; `@elah/core` depends on it directly.
- `transpilePackages` must include `@elah/editor`, `@elah/core`, `@elah/timeline`,
  and `mediabunny` so Next/Turbopack transpiles their ESM and resolves the export
  Web Worker that `@elah/core` spawns.
