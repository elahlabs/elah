# AGENTS.md — React (Vite) playground

A full production editor on `@elah/editor`, in Vite + React 19. Same composition as
[`../next`](../next), without the Next.js specifics.

Building a custom UI from scratch? Start from [`../minimal`](../minimal) instead — this app is
~450 lines of composition and buries the integration contract. Full API reference:
[`../../docs/ai/ELAH_FOR_AI_AGENTS.md`](../../docs/ai/ELAH_FOR_AI_AGENTS.md).

## Commands

```bash
npm install
npm run dev        # http://localhost:4002
npm run typecheck
npm run build
```

## Where to make a change

| Task | File |
| --- | --- |
| Editor layout, header, transport, timeline controls | `src/components/ProductionEditor.tsx` |
| Text clip inspector | `src/components/TextClipProperties.tsx` |
| Export dialog (presets, progress, cancel) | `src/components/ExportModal.tsx` |
| Inline style constants | `src/components/theme.ts` |
| Theme / `--elah-*` overrides | `src/index.css` |
| Stylesheet imports and mount | `src/main.tsx` |

## Do not change

- **The three stylesheet imports in `src/main.tsx`.** All three are required.
- **`worker.format: 'es'` and `optimizeDeps.exclude` in `vite.config.ts`.** Both are required
  for MP4 export to build and run.
- **`@elah/editor` comes from npm**, not the monorepo. Do not add this app to the root
  `workspaces` globs.
- **`lucide-react` must stay in `dependencies`** — it is a peer of `@elah/editor`.

## Patterns used here

- Narrow store selectors (`useTracksStore(s => s.canUndo)`) so toolbars don't re-render per
  frame. `PreviewTransport` goes further and writes the timecode imperatively via
  `usePlaybackStore.subscribe`, avoiding a React render 30×/sec.
- `engine.previewClip(...)` while dragging/typing → `engine.commitInteraction()` on release,
  so a whole gesture is one undo entry. Discrete edits use `engine.updateClip(...)`.
- Export is code-split: `const { lazyExportVideo } = await import('@elah/editor')`.
