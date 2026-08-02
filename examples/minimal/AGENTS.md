# AGENTS.md — minimal starter

The smallest complete `@elah/editor` app. **This is the file set to copy when building a
custom editor UI.**

Full API reference and copy-paste recipes:
[`../../docs/ai/ELAH_FOR_AI_AGENTS.md`](../../docs/ai/ELAH_FOR_AI_AGENTS.md).

## Commands

```bash
npm install
npm run dev        # http://localhost:4003
npm run typecheck
npm run build
```

## Where to make a change

| Task | File |
| --- | --- |
| Add a control (button, slider, inspector) | New file next to `src/PlayButton.tsx`, then render it in `src/Editor.tsx` |
| Change layout / which panels appear | `src/Editor.tsx` |
| Re-theme | `src/index.css` — override `--elah-*` inside `.elah-root` |
| Page chrome (fonts, scrollbars) | `src/index.css` |

## Do not change

- **The three stylesheet imports in `src/main.tsx`.** All three are required; dropping any one
  leaves the editor partly unstyled. See the comment there.
- **`worker.format: 'es'` and `optimizeDeps.exclude` in `vite.config.ts`.** Both are required
  for MP4 export to build and run.
- **`@elah/editor` comes from npm**, not the monorepo. Do not add this app to the root
  `workspaces` globs — it exists to prove the published package works for an outside consumer.
- **`lucide-react` must stay in `dependencies`.** It is a peer of `@elah/editor`; npm
  auto-installs peers but pnpm and yarn do not.

## The four gotchas

Marked `GOTCHA` in `src/Editor.tsx`. Each fails silently — blank canvas or dead timeline, no
error:

1. `createDefaultDemuxerFactory()` must be called once at module scope, not per render.
2. `EditorProvider` reads `fps` / `stage` / `initialTracks` **once, on mount**. Use
   `engine.setStage(w, h)` to resize at runtime.
3. Everything must be inside `className="elah-root"` — that scopes the design tokens.
4. `<Timeline>` needs an explicit height.

## Patterns to follow

- Read state with a **narrow** selector: `usePlaybackStore(s => s.isPlaying)`, never `s => s`.
- Change the project through the engine: `useTimelineEngine()` → `engine.addClip(...)`,
  `engine.updateClip(...)`, `engine.undo()`. Never write to a store.
- Continuous edits (drag, slider, typing): `engine.previewClip(...)` per tick, then one
  `engine.commitInteraction()` at the end. Discrete edits: `engine.updateClip(...)`.
- Time is integer frames, never seconds.
