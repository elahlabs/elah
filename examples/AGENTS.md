# AGENTS.md — examples/

Three standalone apps that install **`@elah/editor` from npm** and prove the published SDK
works for an outside consumer. Read this before touching any of them.

Full API reference and copy-paste recipes:
[`../docs/ai/ELAH_FOR_AI_AGENTS.md`](../docs/ai/ELAH_FOR_AI_AGENTS.md) — self-contained, no
checkout needed.

## Which app

| App | Stack | Port | Pick it when |
| --- | --- | --- | --- |
| [`minimal/`](minimal) | Vite + React 19 | 4003 | **Building a custom UI.** ~130 lines, all integration contract, four gotchas marked inline. |
| [`react/`](react) | Vite + React 19 | 4002 | You want a finished editor to crib from — panels, inspector, export modal. |
| [`next/`](next) | Next.js 16 App Router | 4001 | Same composition on Next.js, plus `ssr: false` mounting and `transpilePackages`. |

`react/` and `next/` render the same `ProductionEditor`; they differ only in the framework
wiring. Change one and you almost certainly want the same change in the other.

Each app has its own `AGENTS.md` with file-level guidance. Start there once you have picked one.

## Commands

```bash
cd examples/<app>
npm install        # resolves @elah/* from the registry
npm run typecheck
npm run dev
npm run build
```

There is no workspace linking here. `npm install` at the repo root does **not** install these —
each app installs independently, on purpose.

## The integration contract

Five things every consumer must get right. All five are already correct in all three apps; if
you break one, the failure is silent or looks like an SDK bug.

1. **Import all three stylesheets, in this order**, at the app root:
   ```ts
   import '@elah/timeline/styles.css'      // ruler, tracks, clips, playhead
   import '@elah/editor/styles.css'        // Preview, AssetPanel, ElementsPanel
   import '@elah/editor/styles/tokens.css' // the 130+ --elah-* design tokens
   ```
   Each package compiles its own stylesheet from its own source, so none contains another's
   classes. Vite apps do this in `src/main.tsx`; the Next app in `app/layout.tsx`.

2. **Everything renders inside `className="elah-root"`.** That is what scopes the `--elah-*`
   tokens. Outside it, components render with unset colours.

3. **`lucide-react` stays in `dependencies`.** It is a peer of `@elah/editor` and
   `@elah/timeline`. npm auto-installs peers so omitting it can appear to work — pnpm, yarn,
   and most AI hosting sandboxes do not.

4. **Bundler config is load-bearing, and it is about the MP4 export worker.** `@elah/core`
   spawns it via `new Worker(new URL('./ExportWorker.js', import.meta.url), { type: 'module' })`.
   - Vite (`vite.config.ts`): `worker.format: 'es'` **and**
     `optimizeDeps.exclude: ['@elah/editor', '@elah/core', '@elah/react', '@elah/timeline', 'mediabunny']`.
   - Next (`next.config.mjs`): the same five in `transpilePackages`.
   Drop either and export breaks at runtime, or the build fails on the `@elah/editor` barrel.

5. **The editor is browser-only** (Canvas, Web Audio, WebCodecs, Workers). On Next.js it must
   be mounted through `dynamic(..., { ssr: false })`.

## Do not

- Add these apps to the root `workspaces` globs, or point them at `packages/*` via
  `file:`/`workspace:`. Consuming the published tarball is the entire point of this directory.
- Commit a `package-lock.json` here — they are gitignored so every clone resolves the newest
  matching `^0.4.x`.
- Reach into `@elah/core` internals for something the `@elah/editor` barrel already re-exports.

## Patterns the SDK expects

- Read state with a **narrow** selector: `usePlaybackStore(s => s.isPlaying)`, never `s => s`.
- Mutate only through the engine: `useTimelineEngine()` → `engine.addClip(...)`,
  `engine.updateClip(...)`, `engine.undo()`. Never write to a store directly.
- Continuous edits (drag, slider, typing): `engine.previewClip(...)` per tick, then one
  `engine.commitInteraction()` at the end. Discrete edits: `engine.updateClip(...)`.
- Time is integer frames, never seconds.
- `createDefaultDemuxerFactory()` is called **once** at module scope or in a ref — never in a
  render body.

## Verified

`@elah/editor@0.4.1`, 2026-08-02 — clean registry install, then `typecheck` + `dev` + `build`
for all three, and a full MP4 export in `react/` and `next/` under both the dev server and the
production build. If you change an app, re-run `npm run verify:examples` from the repo root.
