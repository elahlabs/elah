# @elah/editor — Minimal Starter

The smallest complete Elah editor: **6 files, ~130 lines.** Import media, drag it onto
the timeline, scrub, play.

This is the example to copy when you are building a **custom UI**. The
[`next/`](../next) and [`react/`](../react) examples show a full production editor;
this one shows the integration contract with nothing on top of it.

```bash
cd examples/minimal
npm install
npm run dev      # http://localhost:4003
```

## The whole thing

| File | Lines | What it teaches |
| --- | --- | --- |
| [`src/main.tsx`](src/main.tsx) | ~25 | The **three** stylesheets you must import, and why there are three |
| [`src/Editor.tsx`](src/Editor.tsx) | ~65 | `EditorProvider` → `AssetPanel` + `Preview` + `Timeline`, and the four gotchas |
| [`src/PlayButton.tsx`](src/PlayButton.tsx) | ~35 | **The pattern for every custom control**: narrow selector to read, action to write |
| [`vite.config.ts`](vite.config.ts) | ~20 | The two required bundler settings |
| [`src/index.css`](src/index.css) | ~30 | Where re-theming goes (`--elah-*` tokens) |

## The four gotchas

They are marked `GOTCHA` in [`src/Editor.tsx`](src/Editor.tsx). Each one produces a
blank canvas or a dead timeline rather than an error message:

1. **`createDefaultDemuxerFactory()` must be called once**, at module scope or in a
   `useRef` — not in the component body. It owns decoder state.
2. **`EditorProvider` reads its config once, on mount.** `fps`, `stage`,
   `initialTracks`, and `defaultTrackHeight` are ignored on re-render. Use
   `engine.setStage(w, h)` to resize the canvas at runtime.
3. **Wrap everything in `className="elah-root"`** — that is what scopes the
   `--elah-*` design tokens.
4. **Give `<Timeline>` an explicit height.** It fills its container, and a flex child
   without a height collapses to zero.

## Where to go next

- Add a control → copy [`src/PlayButton.tsx`](src/PlayButton.tsx).
- Edit clips → `const engine = useTimelineEngine()`, then `engine.addClip`,
  `engine.updateClip`, `engine.splitClip`, `engine.undo`.
- Export MP4 → `lazyExportVideo(engine.getProject(), { onProgress })`.
- Everything else →
  [`docs/ai/ELAH_FOR_AI_AGENTS.md`](../../docs/ai/ELAH_FOR_AI_AGENTS.md), the complete
  single-file API reference with copy-paste recipes.

## Notes

- This app installs `@elah/editor` **from npm**, not from the monorepo. It sits outside
  the root `workspaces` globs on purpose, so it proves the published package works.
- The editor is browser-only — Canvas, Web Audio, Web Workers, WebGL2, WebCodecs. It
  cannot server-render. In Next.js, mount it with
  `dynamic(() => import('./Editor'), { ssr: false })`; see [`../next`](../next).
- `lucide-react` is a **peer dependency** of `@elah/editor` (the timeline uses it for
  clip icons). npm installs peers automatically; pnpm and yarn do not — hence the
  explicit entry in `package.json`.
