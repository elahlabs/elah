# PR-04 · Package rename + 3-layer restructure + `MediaLibrary` skeleton

**Status:** 🔴 Not started
**Risk:** High (single package rename + folder restructure + new module — touches every import in the repo)
**Estimated effort:** 4–6 hours
**Blocks:** PR-05 (EditorProvider lands in `editor/`), PR-06 (Renderer/useResolvedScene/useTimelineDrop split across layers), PR-07+ (file import, gallery, DnD, preview)

---

## Goal

Three changes, landed as one atomic PR because they all touch the same import paths:

1. **Rename the package.** `@myeditor/timeline` → `@elah/editor`. The single-package layout stays; only the name changes.
2. **Restructure `src/` into three runtime layers.** Move files into `core/`, `timeline/`, `editor/` to make the architecture visible at a glance.
3. **Add the `MediaLibrary` data layer** (`MediaAsset`, store, drag constants) inside `core/media/`. No UI, no upload, no thumbnails — just the shapes later PRs consume.

After this PR every later ticket can land its code in the right layer without a second restructure.

## Why this PR matters

The folder named `packages/timeline/` no longer matches what lives inside it: engine, playback, resolver, stores, soon EditorProvider, AssetPanel, Preview. New contributors open the folder expecting "timeline rendering" and find an entire editor SDK. The mismatch costs every onboarding.

Separately, the asset model is the single biggest pre-decision in the editor. Two prior attempts (`Oxide-Editor`, `render-kit`) let clips carry only `src: string` and never recovered. An `assetId → MediaAsset` indirection now means thumbnails, waveforms, source-fps metadata live in one place; "re-link" is a single-row update; multiple clips of the same source share storage.

Doing the rename, restructure, and media skeleton together avoids two consecutive "every-import" PRs.

## Target layering (the end state of this PR)

```
packages/editor/                        ← renamed from packages/timeline/
  package.json   → "name": "@elah/editor"
  src/
    core/                               ← Core Runtime Layer (React-agnostic where possible)
      editor/        TimelineEngine + visitors
      playback/      PlaybackEngine
      resolver/      resolveTimeline, scene
      track/         track factory
      elements/      clip factories (video, audio, text, image, base)
      visitor/       add / remove / update / split / clone
      media/         NEW — MediaAsset types, media store
      actions/       splitClipAtPlayhead, ActionResult types
      stores/        tracks.store, playback.store, selection.store
      utils/         frames, id, snap
      types/         shared types (Project, Clip, Track, Transform, …)
    timeline/                           ← Timeline Surface Layer (React UI)
      Timeline.tsx
      ClipBlock.tsx
      TrackRow.tsx
      Ruler.tsx
      Playhead.tsx
      engine-context.ts                 ← back-compat alias (kept for now)
      hooks/         useTracks, usePlayback, useSelection (thin React wrappers, see below)
    editor/                             ← Editor Composition Layer (provider + panels)
      (empty in this PR — populated by PR-05 / PR-06 / PR-07+)
    index.ts                            ← barrel: re-exports from all three layers
```

### Dependency rules

- `core/` may import only from `core/*` and external packages.
- `timeline/` may import from `core/*` and `timeline/*`. **May not** import from `editor/*`.
- `editor/` may import from `core/*`, `timeline/*`, and `editor/*`.
- One-way: **`core → timeline → editor`**. Never the reverse.

These are enforced by review now; PR-06+ may add an ESLint `no-restricted-imports` rule.

### Zustand is an implementation detail

`useTracksStore`, `usePlaybackStore`, `useSelectionStore` continue to live in `core/stores/` and continue to be importable for now, but they are **not the recommended public surface**. The public surface is the React-side wrappers in `timeline/hooks/` (and later `editor/hooks/`):

```ts
// timeline/hooks/index.ts (new)
export { useTracks }    from './useTracks'      // wraps useTracksStore
export { usePlayback }  from './usePlayback'    // wraps usePlaybackStore
export { useSelection } from './useSelection'   // wraps useSelectionStore
```

For PR-04 these wrappers are thin pass-throughs. The point is to give consumers a stable name to import (`import { usePlayback } from '@elah/editor'`) that won't change when the underlying store is refactored.

## Scope

| File | Change |
|---|---|
| `packages/timeline/` → `packages/editor/` | Directory rename |
| `packages/editor/package.json` | `name`: `@myeditor/timeline` → `@elah/editor` |
| `packages/editor/src/` | Restructure: top-level becomes `core/`, `timeline/`, `editor/` |
| `packages/editor/src/core/media/types.ts` (new) | `MediaAsset`, `MediaKind`, `DragMediaPayload`, `MEDIA_DRAG_MIME` |
| `packages/editor/src/core/media/store.ts` (new) | `useMediaLibraryStore` (Zustand, internal) |
| `packages/editor/src/core/media/index.ts` (new) | Barrel; also exports `useMediaLibrary()` wrapper |
| `packages/editor/src/core/types/index.ts` | Add `Clip.assetId?: string` |
| `packages/editor/src/timeline/hooks/{useTracks,usePlayback,useSelection}.ts` (new) | Thin React wrappers around the stores |
| `packages/editor/src/index.ts` | Re-write barrel for new layout; export `useMediaLibrary`, `useTracks`, `usePlayback`, `useSelection`, media types & constants |
| `apps/playground/` | Update every `'@myeditor/timeline'` import → `'@elah/editor'` |
| Root `package.json`, `tsconfig.base.json`, workspace globs | Update path / name references |
| `packages/editor/src/core/media/store.test.ts` (new, recommended) | 2 small store tests |

> **Note on file moves:** prefer `git mv` so blame survives. The internal contents of each moved file don't change in this PR — only their location and import paths.

## Acceptance criteria

### Rename + restructure

- [ ] Package renamed to `@elah/editor` in `packages/editor/package.json`. The folder is `packages/editor/`, not `packages/timeline/`.
- [ ] `src/` contains exactly three top-level non-file entries: `core/`, `timeline/`, `editor/`. Plus `index.ts`.
- [ ] Every existing file has moved into the correct layer per the layering map above. No file remains under an old path.
- [ ] All imports inside `packages/editor/src/` use relative paths (`../core/...`, `./...`) — no `@elah/editor` self-imports.
- [ ] All imports in `apps/playground/` use `'@elah/editor'`.
- [ ] No file in `core/` imports anything from `timeline/` or `editor/`.
- [ ] No file in `timeline/` imports anything from `editor/`.
- [ ] `npx tsc --noEmit` passes.
- [ ] `npm run test` — all existing tests pass without changes beyond import-path updates.
- [ ] `npm run dev` — playground works identically; no UI / behavior change.

### MediaLibrary skeleton

- [ ] `MediaAsset` interface defined with fields: `id`, `kind` (`'video' | 'audio' | 'image'`), `name`, `src`, `durationSec`, `width?`, `height?`, `sourceFps?`, `thumbnailUrl?`, `waveform?` (`Float32Array | undefined`), `byteSize`, `addedAt`.
- [ ] `useMediaLibraryStore` (Zustand) with state `{ assets: Record<string, MediaAsset>, order: string[] }` and actions `addAsset`, `removeAsset`, `updateAsset`, `getAsset`. `order` stays insertion-ordered.
- [ ] `MEDIA_DRAG_MIME = 'application/x-elah-media'` exported as a `const`. (Note: namespace updated from `myeditor` to `elah` as part of the rename.)
- [ ] `DragMediaPayload = { kind: 'media-asset'; assetId: string }` exported.
- [ ] `Clip.assetId?: string` added in `core/types/index.ts`.
- [ ] `useMediaLibrary()` thin wrapper exported from `core/media/index.ts` (preferred public surface).
- [ ] `useMediaLibraryStore` remains exported for now (until a follow-up locks it down as internal).
- [ ] No new runtime dependencies.

### Public API hygiene

- [ ] `packages/editor/src/index.ts` is organized into commented sections that mirror the layers:
  ```ts
  // --- Core: types ---
  // --- Core: engine ---
  // --- Core: playback ---
  // --- Core: resolver ---
  // --- Core: media ---
  // --- Timeline: UI ---
  // --- Timeline: hooks ---
  // --- Editor: composition ---   (empty until PR-05)
  ```
- [ ] Existing public names (`Timeline`, `TimelineEngine`, `PlaybackEngine`, `resolveTimeline`, etc.) are still exported. No breaking removals — this PR is a rename + move, not an API trim.

## Out of scope

- **No `EditorProvider`** — PR-05.
- **No `Renderer` interface or `useResolvedScene`** — PR-06.
- **No file upload / import / thumbnails / metadata extraction** — PR-07.
- **No `<AssetPanel>` UI** — PR-08.
- **No DnD wiring on the timeline** — PR-09.
- **No `<Preview>` or `DomRenderer`** — PR-10.
- **No persistence.**
- **Do not remove `Clip.src`** — keep it; add `assetId?` alongside.
- **Do not change the resolver's runtime behavior.** Optional `assetId → src` resolution can land in PR-07 or PR-10; not here.
- **Do not introduce an ESLint import-boundary rule** in this PR — review-enforced for now; mechanical rule comes when the layering settles.
- **Do not lock `useMediaLibraryStore` as internal yet.** That's a follow-up after the hook wrappers are validated.
- **No extraction into multiple npm packages.** Future-extraction paths (`@elah/core`, `@elah/timeline`, `@elah/player`, `@elah/renderer`) remain deferred until real demand exists (non-React consumer, bundle separation need, or independent adoption).

## Implementation notes

### Step 1 — Rename the package

```bash
git mv packages/timeline packages/editor
```

Then in `packages/editor/package.json`:
```json
{
  "name": "@elah/editor"
}
```

Update workspace references (root `package.json` workspaces array, `tsconfig.base.json` paths, any Vite alias).

### Step 2 — Restructure the source tree

Move files using `git mv` so blame is preserved. The mapping (old → new):

| Old path (`packages/timeline/src/...`) | New path (`packages/editor/src/...`) |
|---|---|
| `types/index.ts` | `core/types/index.ts` |
| `core/editor/TimelineEngine.ts` | `core/editor/TimelineEngine.ts` |
| `core/elements/*` | `core/elements/*` |
| `core/playback/PlaybackEngine.ts` | `core/playback/PlaybackEngine.ts` |
| `core/resolver/*` | `core/resolver/*` |
| `core/track/track.ts` | `core/track/track.ts` |
| `core/visitor/*` | `core/visitor/*` |
| `actions/*` | `core/actions/*` |
| `stores/*` | `core/stores/*` |
| `utils/*` | `core/utils/*` |
| `ui/Timeline.tsx` | `timeline/Timeline.tsx` |
| `ui/ClipBlock.tsx` | `timeline/ClipBlock.tsx` |
| `ui/TrackRow.tsx` | `timeline/TrackRow.tsx` |
| `ui/Ruler.tsx` | `timeline/Ruler.tsx` |
| `ui/Playhead.tsx` | `timeline/Playhead.tsx` |
| `ui/engine-context.ts` | `timeline/engine-context.ts` (back-compat alias remains) |

After moves, update relative imports inside each moved file. A find-and-replace works for most: `../../types` → `../core/types`, `../../core/...` → `../core/...`, etc. Run `npx tsc --noEmit` after each batch.

### Step 3 — Add `core/media/`

```ts
// packages/editor/src/core/media/types.ts

/** Kind of media this asset represents. */
export type MediaKind = 'video' | 'audio' | 'image'

/**
 * A single piece of source media registered in the editor's MediaLibrary.
 * Clips reference assets by `id`; the asset owns the metadata (duration,
 * dimensions, source fps, thumbnail) so multiple clips can share a source
 * without duplicating it.
 */
export interface MediaAsset {
  id: string
  kind: MediaKind
  name: string
  /** Object URL, blob URL, or persisted asset URL. */
  src: string
  /** Source duration in seconds. */
  durationSec: number
  width?: number
  height?: number
  /** Intrinsic frame rate of the source. Undefined for audio / image. */
  sourceFps?: number
  /** Generated thumbnail. Set asynchronously by PR-07. */
  thumbnailUrl?: string
  /** Pre-decoded waveform peaks for audio. Placeholder until PR-07+. */
  waveform?: Float32Array
  byteSize: number
  /** Epoch ms. Used for display order and tie-breaking. */
  addedAt: number
}

/** MIME type used on `dataTransfer` for drags originating from the AssetPanel. */
export const MEDIA_DRAG_MIME = 'application/x-elah-media'

/** Payload encoded into `dataTransfer.getData(MEDIA_DRAG_MIME)`. */
export interface DragMediaPayload {
  kind: 'media-asset'
  assetId: string
}
```

```ts
// packages/editor/src/core/media/store.ts
import { create } from 'zustand'
import type { MediaAsset } from './types'

interface MediaLibraryState {
  assets: Record<string, MediaAsset>
  order: string[]
}

interface MediaLibraryActions {
  addAsset: (asset: MediaAsset) => void
  removeAsset: (id: string) => void
  updateAsset: (id: string, patch: Partial<MediaAsset>) => void
  getAsset: (id: string) => MediaAsset | undefined
}

/**
 * Internal store. Prefer `useMediaLibrary()` for React consumers.
 * Imperative access via `useMediaLibraryStore.getState()` is intended
 * for non-React code paths (workers, actions) only.
 */
export const useMediaLibraryStore = create<MediaLibraryState & MediaLibraryActions>(
  (set, get) => ({
    assets: {},
    order: [],
    addAsset: (asset) =>
      set((s) => ({
        assets: { ...s.assets, [asset.id]: asset },
        order: s.order.includes(asset.id) ? s.order : [...s.order, asset.id],
      })),
    removeAsset: (id) =>
      set((s) => {
        const { [id]: _removed, ...rest } = s.assets
        return { assets: rest, order: s.order.filter((x) => x !== id) }
      }),
    updateAsset: (id, patch) =>
      set((s) => {
        const existing = s.assets[id]
        if (!existing) return s
        return { assets: { ...s.assets, [id]: { ...existing, ...patch } } }
      }),
    getAsset: (id) => get().assets[id],
  }),
)
```

```ts
// packages/editor/src/core/media/index.ts
import { useMediaLibraryStore } from './store'
import type { MediaAsset } from './types'

export type { MediaAsset, MediaKind, DragMediaPayload } from './types'
export { MEDIA_DRAG_MIME } from './types'
export { useMediaLibraryStore } from './store'

/**
 * Public hook for reading the media library.
 * Returns assets in insertion order.
 */
export function useMediaLibrary(): {
  assets: MediaAsset[]
  getAsset: (id: string) => MediaAsset | undefined
} {
  const order = useMediaLibraryStore((s) => s.order)
  const assets = useMediaLibraryStore((s) => s.assets)
  const getAsset = useMediaLibraryStore((s) => s.getAsset)
  return {
    assets: order.map((id) => assets[id]).filter(Boolean) as MediaAsset[],
    getAsset,
  }
}
```

### Step 4 — Add `Clip.assetId?`

```ts
// packages/editor/src/core/types/index.ts (inside Clip)
export interface Clip {
  // ...existing fields...
  /**
   * Optional reference to a MediaAsset in the MediaLibrary. When set, the
   * renderer prefers this lookup over `src`. Both can coexist during
   * the migration to an assetId-only model.
   */
  assetId?: string
}
```

### Step 5 — Hook wrappers (thin pass-throughs)

```ts
// packages/editor/src/timeline/hooks/useTracks.ts
import { useTracksStore } from '../../core/stores/tracks.store'
export const useTracks = useTracksStore   // thin pass-through for now
```

Identical pattern for `usePlayback`, `useSelection`. The wrappers exist so consumers' import sites are stable when the stores are eventually hidden.

### Step 6 — Rewrite `src/index.ts`

Organize exports by layer with section comments. Add the new exports:
- `useMediaLibrary`, `useMediaLibraryStore`, `MediaAsset`, `MediaKind`, `MEDIA_DRAG_MIME`, `DragMediaPayload`.
- `useTracks`, `usePlayback`, `useSelection`.

Keep everything that was exported before. This PR adds; it does not remove.

### Step 7 — Update playground

```diff
- import { Timeline, TimelineEngine } from '@myeditor/timeline'
+ import { Timeline, TimelineEngine } from '@elah/editor'
```

Repeat for every import site. Re-run the dev server; everything should look identical.

## Verification

1. `npx tsc --noEmit` — clean across the whole repo.
2. `npm run test` — all tests pass. Update only the imports inside test files; assertions stay the same.
3. `npm run dev` — playground works identically: add tracks, add clips, play, undo, trim, split, zoom.
4. Sanity-check MediaLibrary in devtools:
   ```ts
   import('@elah/editor').then(({ useMediaLibraryStore }) => {
     const s = useMediaLibraryStore.getState()
     s.addAsset({
       id: 'a1', kind: 'video', name: 't', src: 'x',
       durationSec: 5, byteSize: 0, addedAt: Date.now(),
     })
     console.log(s.getAsset('a1'))
   })
   ```
5. Grep the repo for `@myeditor/timeline` and `packages/timeline` — both must be zero hits.
6. Grep `src/ui/` — must not exist.

---

## Copy-paste prompt for the implementation agent

```text
You are working on the Elah editor monorepo. Your job is to do ONE atomic PR
that combines three changes (because they all touch the same imports):

  1. Rename the package: @myeditor/timeline → @elah/editor.
  2. Restructure src/ into three runtime layers: core/, timeline/, editor/.
  3. Add the MediaLibrary data layer (types + store + drag constants)
     in core/media/.

REPO: d:/opensource/ReferenceProjects/MyEditorPackage

HARD CONSTRAINTS:
- Behavior is identical after this PR. Every keyboard shortcut, every
  toolbar action, every drag must produce the same result.
- Do NOT change any class APIs (TimelineEngine, PlaybackEngine, etc.).
- Do NOT change resolver runtime behavior.
- Do NOT remove Clip.src — keep it; add Clip.assetId? alongside.
- Use `git mv` for all file moves so blame is preserved.
- No new runtime dependencies.
- Do NOT add an EditorProvider, Renderer, useResolvedScene, AssetPanel, or
  Preview. Those are later PRs.

================================================================
STEP 1 — Rename the package directory and the npm name
================================================================
1. `git mv packages/timeline packages/editor`
2. In packages/editor/package.json set `"name": "@elah/editor"`.
3. Update workspace globs, root package.json, tsconfig path aliases,
   and any Vite/Vitest aliases.

================================================================
STEP 2 — Restructure src/ into core/ + timeline/ + editor/
================================================================
Move files per this mapping (old → new), all under packages/editor/src/:

  types/index.ts                         → core/types/index.ts
  core/editor/TimelineEngine.ts          → core/editor/TimelineEngine.ts
  core/elements/*                        → core/elements/*
  core/playback/PlaybackEngine.ts        → core/playback/PlaybackEngine.ts
  core/resolver/*                        → core/resolver/*
  core/track/track.ts                    → core/track/track.ts
  core/visitor/*                         → core/visitor/*
  actions/*                              → core/actions/*
  stores/*                               → core/stores/*
  utils/*                                → core/utils/*

  ui/Timeline.tsx                        → timeline/Timeline.tsx
  ui/ClipBlock.tsx                       → timeline/ClipBlock.tsx
  ui/TrackRow.tsx                        → timeline/TrackRow.tsx
  ui/Ruler.tsx                           → timeline/Ruler.tsx
  ui/Playhead.tsx                        → timeline/Playhead.tsx
  ui/engine-context.ts                   → timeline/engine-context.ts

Create an empty editor/ directory (no files yet — PR-05+ populates it).

Update all relative imports inside the moved files. Run `npx tsc --noEmit`
after each batch.

DEPENDENCY RULE: core/ may not import from timeline/ or editor/.
                 timeline/ may not import from editor/.
                 editor/ may import from anything.

If you find an import that violates this rule after the move, STOP and
report it. The fix may require a different layout decision.

================================================================
STEP 3 — Add core/media/
================================================================
New files:
  packages/editor/src/core/media/types.ts   (MediaAsset, MediaKind,
                                             MEDIA_DRAG_MIME, DragMediaPayload)
  packages/editor/src/core/media/store.ts   (useMediaLibraryStore — zustand)
  packages/editor/src/core/media/index.ts   (barrel; also exports
                                             useMediaLibrary() wrapper)

MEDIA_DRAG_MIME value: 'application/x-elah-media'

useMediaLibrary() returns { assets: MediaAsset[] (in insertion order),
                            getAsset(id) }.

DO NOT add persistence. DO NOT add file import. DO NOT add thumbnails.

================================================================
STEP 4 — Add Clip.assetId?
================================================================
In packages/editor/src/core/types/index.ts, add:
  assetId?: string
to the Clip interface, with a JSDoc explaining it's a reference into
MediaLibrary and that `src` remains as a fallback during migration.

================================================================
STEP 5 — Thin hook wrappers
================================================================
New files (each is a one-line re-export for now):
  packages/editor/src/timeline/hooks/useTracks.ts
    export const useTracks = useTracksStore
  packages/editor/src/timeline/hooks/usePlayback.ts
    export const usePlayback = usePlaybackStore
  packages/editor/src/timeline/hooks/useSelection.ts
    export const useSelection = useSelectionStore
  packages/editor/src/timeline/hooks/index.ts (barrel)

================================================================
STEP 6 — Rewrite packages/editor/src/index.ts
================================================================
Organize exports into layered sections with comment headers:
  // --- Core: types ---
  // --- Core: engine ---
  // --- Core: playback ---
  // --- Core: resolver ---
  // --- Core: media ---
  // --- Core: stores (low-level; prefer the hooks below) ---
  // --- Timeline: UI ---
  // --- Timeline: hooks ---
  // --- Editor: composition ---   (empty placeholder section)

ADD the new exports: useMediaLibrary, useMediaLibraryStore, MediaAsset,
MediaKind, MEDIA_DRAG_MIME, DragMediaPayload, useTracks, usePlayback,
useSelection.

DO NOT remove anything that was exported before. Update import paths.

================================================================
STEP 7 — Update the playground
================================================================
Find-and-replace `'@myeditor/timeline'` → `'@elah/editor'` across
apps/playground/. No other changes needed.

================================================================
VERIFICATION
================================================================
1. `npx tsc --noEmit` clean across the repo.
2. `npm run test` all tests pass (update only test-file import paths).
3. `npm run dev` playground works identically — every existing keyboard
   shortcut, toolbar button, drag, trim, undo/redo works as before.
4. `grep -r '@myeditor/timeline' .` returns zero results.
5. `grep -r 'packages/timeline' .` returns zero results.
6. `packages/editor/src/ui/` does not exist.
7. Devtools sanity check for media:
     const s = (await import('@elah/editor')).useMediaLibraryStore.getState()
     s.addAsset({ id: 'a1', kind: 'video', name: 't', src: 'x',
                  durationSec: 5, byteSize: 0, addedAt: Date.now() })
     console.log(s.getAsset('a1'))

================================================================
DELIVERABLE
================================================================
A commit titled:
  chore: rename @myeditor/timeline → @elah/editor and restructure into
  core/ timeline/ editor/ layers + add MediaLibrary skeleton

================================================================
NON-GOALS (do NOT do these)
================================================================
- No EditorProvider, Renderer, useResolvedScene, AssetPanel, Preview.
- No file upload / thumbnails / metadata extraction / DnD wiring.
- No persistence.
- No ESLint import-boundary rule (review-enforced for now).
- No extraction into multiple npm packages.
- Do not remove Clip.src.
- Do not "improve" unrelated code while you're in there.
```

---

## Notes for what comes next

This PR may surface directional issues — circular imports between `core/` and `timeline/` that the current layout hides, store fields that the hook wrappers can't cleanly project, file moves that conflict with in-flight branches. **Expect to reorder or rewrite PR-05 / PR-06 once PR-04 is merged and the layering is real.** The current sketches assume the structure above; revise them with fresh eyes after this lands.
