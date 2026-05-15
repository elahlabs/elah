# PR-04 · `MediaLibrary` skeleton + asset model

**Status:** 🔴 Not started
**Risk:** Medium (introduces a new module that all later PRs depend on)
**Estimated effort:** 2–3 hours
**Blocks:** PR-07 (file import), PR-08 (gallery UI), PR-09 (DnD), PR-10 (renderer asset resolution)

---

## Goal

Stand up the **types, store, and constants** for the media library — without any UI, upload, decode, or thumbnail logic. After this PR, every later PR can import `MediaAsset`, `useMediaLibraryStore`, `MEDIA_DRAG_MIME`, and `DragMediaPayload` from a stable home.

## Why this PR matters

The asset model is the single biggest pre-decision in the editor. Two prior attempts (`Oxide-Editor`, `render-kit`) made the mistake of letting clips carry only a raw `src: string`, and never recovered. Putting an `assetId → MediaAsset` indirection in place now means:

- Thumbnails / waveforms / source-fps metadata live in one place, not duplicated on every clip.
- Replacing a missing file ("re-link") is a single-row update.
- Multiple clips of the same source share storage cleanly.

We're keeping `Clip.src` for now (coexists with `assetId`) so this PR doesn't break existing playground interactions. Migration to assetId-only happens organically as PRs 7–10 land.

## Scope

| File | Change |
|---|---|
| `packages/timeline/src/core/media/types.ts` (new) | `MediaAsset`, `MediaKind`, `DragMediaPayload`, `MEDIA_DRAG_MIME` |
| `packages/timeline/src/core/media/store.ts` (new) | `useMediaLibraryStore` (Zustand) |
| `packages/timeline/src/types/index.ts` | Add `Clip.assetId?: string` |
| `packages/timeline/src/core/resolver/resolveTimeline.ts` | (Optional, see notes) accept a `MediaLibrary` resolver to convert `assetId` → `src` |
| `packages/timeline/src/index.ts` | Export new types + store + constants |
| `packages/timeline/src/core/media/store.test.ts` (new, optional) | 2 tiny store tests |

## Acceptance criteria

- [ ] `MediaAsset` interface is defined with fields: `id`, `kind` (`'video' | 'audio' | 'image'`), `name`, `src`, `durationSec`, `width?`, `height?`, `sourceFps?`, `thumbnailUrl?`, `waveform?` (placeholder, `Float32Array | undefined`), `byteSize`, `addedAt`.
- [ ] `useMediaLibraryStore` Zustand store with state `{ assets: Record<string, MediaAsset>, order: string[] }` and actions `addAsset(asset)`, `removeAsset(id)`, `updateAsset(id, patch)`, `getAsset(id) → MediaAsset | undefined`.
- [ ] `order` stays in insertion order — pushing on add, filtering on remove.
- [ ] `MEDIA_DRAG_MIME = 'application/x-myeditor-media'` exported as a `const`.
- [ ] `DragMediaPayload = { kind: 'media-asset'; assetId: string }` exported.
- [ ] `Clip.assetId?: string` added in `types/index.ts`.
- [ ] All new types/values exported from the package's `index.ts`.
- [ ] `npx tsc --noEmit` clean.
- [ ] All existing tests (PR-02, PR-03) still pass.
- [ ] No new runtime dependencies.

## Out of scope

- **No file upload / import** — that's PR-07.
- **No thumbnail generation** — PR-07.
- **No metadata extraction** (probing videos for fps/duration) — PR-07.
- **No gallery UI** — PR-08.
- **No DnD wiring** — PR-09.
- **No worker integration.**
- **No persistence** (no localStorage for assets — they're object URLs, can't survive reload anyway).
- **No "re-link missing file" workflow** — future PR.
- **Do not change resolver behavior** unless implementing the optional `assetId → src` resolution; even then keep it backward-compatible.

## Implementation notes

### Types

```ts
// packages/timeline/src/core/media/types.ts

export type MediaKind = 'video' | 'audio' | 'image'

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
  /** Intrinsic frame rate of the source media. Undefined for audio/image. */
  sourceFps?: number
  /** Generated thumbnail (data URL or blob URL). Set asynchronously. */
  thumbnailUrl?: string
  /** Pre-decoded waveform peaks for audio. Placeholder for future PR. */
  waveform?: Float32Array
  byteSize: number
  addedAt: number
}

/** MIME type for drag-drop payloads originating from MediaGallery. */
export const MEDIA_DRAG_MIME = 'application/x-myeditor-media'

export interface DragMediaPayload {
  kind: 'media-asset'
  assetId: string
}
```

### Store

```ts
// packages/timeline/src/core/media/store.ts
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

### Schema addition

```ts
// packages/timeline/src/types/index.ts (in Clip)
export interface Clip {
  // ...existing fields...
  /**
   * Optional reference to a MediaAsset in the MediaLibrary. When set, the
   * renderer should prefer this lookup over `src`. Today, both can coexist
   * during the migration to an assetId-only model.
   */
  assetId?: string
}
```

### Optional: resolver `assetId → src` resolution

If you want to wire it now (recommended), give `resolveTimeline` a second optional parameter:

```ts
export interface ResolveOptions {
  resolveAsset?: (assetId: string) => MediaAsset | undefined
}

export function resolveTimeline(
  frame: number,
  project: Project,
  options?: ResolveOptions,
): Scene { ... }
```

Inside the per-clip branches:
```ts
const src =
  (clip.assetId && options?.resolveAsset?.(clip.assetId)?.src) ?? clip.src
if (!src) continue // skip clip if no resolvable src
```

Make sure existing call sites without `options` still work. **If this feels like too much for one PR, defer to PR-07.** This PR's primary deliverable is the data shape.

### Public API exports

```ts
// packages/timeline/src/index.ts — add a "Media" section
export { useMediaLibraryStore } from './core/media/store'
export {
  MEDIA_DRAG_MIME,
  type MediaAsset,
  type MediaKind,
  type DragMediaPayload,
} from './core/media/types'
```

## Verification

1. `npx tsc --noEmit` — clean.
2. `npm run test` — existing tests pass.
3. In a temporary playground experiment (don't commit):
   ```ts
   import { useMediaLibraryStore } from '@myeditor/timeline'
   const lib = useMediaLibraryStore.getState()
   lib.addAsset({ id: 'a1', kind: 'video', name: 't', src: 'x', durationSec: 5, byteSize: 0, addedAt: Date.now() })
   console.log(lib.getAsset('a1'))
   lib.removeAsset('a1')
   ```
   Confirm it behaves as expected.

---

## Copy-paste prompt for the implementation agent

```text
You are working on @myeditor/timeline. Your job is to introduce the media
library *types, store, and constants* — no UI, no file import, no
thumbnails, no decoding. Just the shapes that later PRs will use.

REPO: d:/opensource/ReferenceProjects/MyEditorPackage

HARD CONSTRAINTS:
- Do NOT add file upload / import logic.
- Do NOT add thumbnail generation.
- Do NOT add metadata extraction (videoEl.onloadedmetadata, etc.).
- Do NOT add UI components.
- Do NOT add DnD wiring.
- Do NOT touch persistence.
- Do NOT remove `Clip.src` — keep it; add `Clip.assetId?` alongside.
- No new runtime dependencies.

================================================================
TASK 1 — Create media types module
================================================================
File: packages/timeline/src/core/media/types.ts (new)

Define:

  export type MediaKind = 'video' | 'audio' | 'image'

  export interface MediaAsset {
    id: string
    kind: MediaKind
    name: string
    src: string             // object URL or persisted URL
    durationSec: number
    width?: number
    height?: number
    sourceFps?: number      // undefined for audio/image
    thumbnailUrl?: string   // set asynchronously by PR-07
    waveform?: Float32Array // placeholder for PR-07+
    byteSize: number
    addedAt: number
  }

  export const MEDIA_DRAG_MIME = 'application/x-myeditor-media'

  export interface DragMediaPayload {
    kind: 'media-asset'
    assetId: string
  }

Include JSDoc on MediaAsset.

================================================================
TASK 2 — Create the MediaLibrary store
================================================================
File: packages/timeline/src/core/media/store.ts (new)

Implement useMediaLibraryStore as a Zustand store with:

  State: { assets: Record<string, MediaAsset>, order: string[] }
  Actions:
    addAsset(asset)     — adds to assets; appends id to `order` if new
    removeAsset(id)     — removes from both maps
    updateAsset(id, patch) — shallow merges patch onto existing asset; no-op if
                             the asset doesn't exist
    getAsset(id)        — returns the asset or undefined

DO NOT add persistence (no zustand/persist).

================================================================
TASK 3 — Add Clip.assetId? to the Clip interface
================================================================
File: packages/timeline/src/types/index.ts

Add an optional field:
  assetId?: string

Include JSDoc explaining it's a reference into MediaLibrary and that `src`
remains as a fallback during migration.

DO NOT make assetId required. DO NOT remove src.

================================================================
TASK 4 — Update the package's public API
================================================================
File: packages/timeline/src/index.ts

Add a "--- Media library ---" section exporting:
  useMediaLibraryStore
  MEDIA_DRAG_MIME
  type MediaAsset
  type MediaKind
  type DragMediaPayload

================================================================
TASK 5 (OPTIONAL — only if straightforward) — Resolver assetId lookup
================================================================
If you can do it cleanly without expanding scope:

File: packages/timeline/src/core/resolver/resolveTimeline.ts

Add an optional third parameter:

  export interface ResolveOptions {
    resolveAsset?: (assetId: string) => { src: string } | undefined
  }

  export function resolveTimeline(
    frame: number,
    project: Project,
    options?: ResolveOptions,
  ): Scene { ... }

In each per-clip branch that requires `src`, prefer
options?.resolveAsset(clip.assetId)?.src over clip.src.

If the lookup yields nothing AND clip.src is missing, skip the clip.

If options is undefined, behavior is identical to today.

If this expands the diff meaningfully, DEFER this task to PR-07.

================================================================
VERIFICATION
================================================================
1. npx tsc --noEmit  → clean
2. npm run test     → all existing tests pass
3. Manual sanity check in browser devtools after running `npm run dev`:
   ```
   import('@myeditor/timeline').then(({ useMediaLibraryStore }) => {
     const s = useMediaLibraryStore.getState()
     s.addAsset({
       id: 'a1', kind: 'video', name: 't', src: 'x',
       durationSec: 5, byteSize: 0, addedAt: Date.now(),
     })
     console.log(s.getAsset('a1'))
   })
   ```
   Confirm output is correct.

================================================================
DELIVERABLE
================================================================
A commit titled:
  media: add MediaLibrary types, store, and drag-drop constants

================================================================
NON-GOALS (reminder — do NOT do any of these)
================================================================
- No upload logic.
- No thumbnail generation.
- No metadata extraction.
- No gallery component.
- No DnD wiring on the timeline.
- No persistence (assets are object URLs and can't survive reload anyway).
- No "re-link missing file" workflow.
- Do not remove Clip.src.
- Do not introduce new runtime dependencies.
```
