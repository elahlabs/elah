# AGENTS.md — Next.js example

A full production editor on `@elah/editor`, in Next.js 16 (App Router).

Building a custom UI from scratch? Start from [`../minimal`](../minimal) instead — this app is
~450 lines of composition and buries the integration contract. Full API reference:
[`../../docs/ai/ELAH_FOR_AI_AGENTS.md`](../../docs/ai/ELAH_FOR_AI_AGENTS.md).

## Commands

```bash
npm install
npm run dev        # http://localhost:4001
npm run typecheck
npm run build
```

## Where to make a change

| Task | File |
| --- | --- |
| Editor layout, header, transport, timeline controls | `components/ProductionEditor.tsx` |
| Text clip inspector | `components/TextClipProperties.tsx` |
| Export dialog (presets, progress, cancel) | `components/ExportModal.tsx` |
| Inline style constants | `components/theme.ts` |
| Theme / `--elah-*` overrides | `app/globals.css` |
| Stylesheet imports | `app/layout.tsx` |

## Do not change

- **`dynamic(..., { ssr: false })` in `app/page.tsx`.** The editor uses Canvas, WebGL2, Web
  Audio, and Workers — it cannot server-render. Removing this breaks the build.
- **The three stylesheet imports in `app/layout.tsx`.** All three are required.
- **`transpilePackages` in `next.config.mjs`.** Without it the build fails on the
  `@elah/editor` barrel.
- **`@elah/editor` comes from npm**, not the monorepo. Do not add this app to the root
  `workspaces` globs.
- **`lucide-react` must stay in `dependencies`** — it is a peer of `@elah/editor`.

## Patterns used here

- `'use client'` on every component that touches the SDK.
- Narrow store selectors (`useTracksStore(s => s.canUndo)`) so toolbars don't re-render per
  frame. `PreviewTransport` goes further and writes the timecode imperatively via
  `usePlaybackStore.subscribe`, avoiding a React render 30×/sec.
- `engine.previewClip(...)` while dragging/typing → `engine.commitInteraction()` on release,
  so a whole gesture is one undo entry. Discrete edits use `engine.updateClip(...)`.
- Export is code-split: `const { lazyExportVideo } = await import('@elah/editor')`.
