# @elah/editor — React (Vite) Example

A standalone Vite + React + TypeScript app showcasing the **production editor** built on
[`@elah/editor`](https://www.npmjs.com/package/@elah/editor), installed **from npm** —
this app is intentionally *outside* the monorepo workspace so it consumes the published
package, not the local `packages/editor` source.

## Run

```bash
cd examples/react
npm install
npm run dev      # http://localhost:4002
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
| Mount | [`src/main.tsx`](src/main.tsx) |
| SDK stylesheets (all **three**) | [`src/main.tsx`](src/main.tsx) |
| Editor composition | [`src/components/ProductionEditor.tsx`](src/components/ProductionEditor.tsx) |
| Bundler config | [`vite.config.ts`](vite.config.ts) |
| Theming (`--elah-*` overrides) | [`src/index.css`](src/index.css) |

## Notes

- **Three stylesheets are required** — `@elah/timeline/styles.css`,
  `@elah/editor/styles.css`, and `@elah/editor/styles/tokens.css`. Each package compiles
  its own, so they don't contain each other's classes.
- **`lucide-react` is a peer dependency** of `@elah/editor` and is declared explicitly in
  `package.json`. npm auto-installs peers; pnpm and yarn do not.
- The video decoder is wired with the SDK's built-in
  `createDefaultDemuxerFactory()` — no need to install or import `mediabunny`
  yourself; `@elah/core` depends on it directly.
- `vite.config.ts` sets `worker.format: 'es'` and excludes `@elah/*` + `mediabunny`
  from `optimizeDeps` so the export Web Worker (`new URL('./ExportWorker.js', import.meta.url)`
  inside `@elah/core`) resolves from the real module files. Both settings are required.

## Building a custom UI?

Start from [`../minimal`](../minimal) — the same integration in ~130 readable lines. The
complete API reference with copy-paste recipes is
[`docs/ai/ELAH_FOR_AI_AGENTS.md`](../../docs/ai/ELAH_FOR_AI_AGENTS.md).
