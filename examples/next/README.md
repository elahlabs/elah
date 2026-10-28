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
- A custom properties panel (`TextClipProperties`) using the editor's zustand stores,
  with the built-in text templates (`applyTextTemplate`) and every entry/exit animation kind
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

- `package.json` currently declares `@elah/editor@^0.6.0`, which resolves 0.6.x, not the
  1.0.0 release of 2026-10-28. Widen it to `^1.0.0` to use 1.0. The last full verification
  (install, typecheck, dev, build, MP4 export under dev and production) was on 0.6.0 on
  2026-10-02 and is owed again on 1.0.0; see [`../README.md`](../README.md).
  `npm run verify:examples` from the repo root builds all three examples.
- The 1.0 SDK includes the motion layer (keyframes, springs, stagger, motion paths, text
  animators, expressions, 3D tilt, GPU effects, generators, transitions, compound and
  sequence clips, Lottie / SVG import). This app's UI does not expose a control for each.

## Building a custom UI?

Start from [`../minimal`](../minimal) — the same integration in ~130 readable lines. The
complete API reference with copy-paste recipes is
[`docs/ai/ELAH_FOR_AI_AGENTS.md`](../../docs/ai/ELAH_FOR_AI_AGENTS.md).
