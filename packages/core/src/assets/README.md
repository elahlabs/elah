# `core/assets`

The assets subsystem owns the editor's **source asset registry**. It answers one question for every other system in the codebase:

> _"What source files are available, and what metadata do they carry?"_

Clips on the timeline reference assets by `id` rather than duplicating URLs and metadata. The Asset panel reads from this registry, and timeline drop handlers resolve dragged assets back into clip creation.

---

## What lives here

| File | Purpose |
| --- | --- |
| [`types.ts`](./types.ts) | `MediaAsset`, `MediaKind`, drag MIME constants |
| [`store.ts`](./store.ts) | Zustand store — in-memory asset registry |
| [`importFiles.ts`](./importFiles.ts) | File import, metadata probing, thumbnail generation |
| [`importFiles.test.ts`](./importFiles.test.ts) | Unit tests for import, probe, and thumbnail helpers |
| [`index.ts`](./index.ts) | Public exports and `useMediaLibrary()` hook |

UI integration lives in the `@elah/editor` package's [`AssetPanel.tsx`](../../../../editor/src/editor/AssetPanel/AssetPanel.tsx). Timeline drop handling consumes `MEDIA_DRAG_MIME` via the `@elah/timeline` package's [`useTimelineDrop.ts`](../../../../timeline/src/useTimelineDrop.ts).

---

## Mental model

A `MediaAsset` is a registered source file with stable metadata:

> **Decode pipeline link**: `MediaAsset.src` (an object URL) is the value passed
> as `ActiveVideoClip.src` by `resolveTimeline`, and ultimately as `src` to the
> video provider's `open(src)`. The decode pipeline begins here.
> See [`core/media/video/README.md`](../media/video/README.md) and
> [`core/renderer/architecture.md` § 6](../renderer/architecture.md)
> for the full chain and known limitations (no persistence, blob-fetch round-trip, etc.).

```
MediaAsset
  id            — unique key; clips store assetId, not the blob URL
  kind          — 'video' | 'audio' | 'image'
  src           — object URL (URL.createObjectURL) for now
  durationSec   — probed from the source
  width/height  — probed for video/image
  thumbnailUrl  — JPEG data URL, set asynchronously after import
  byteSize      — original File.size
  lastModified  — original File.lastModified; used for dedupe
  addedAt       — insertion timestamp; drives display order
```

Multiple clips can share one asset. The asset owns duration, dimensions, and thumbnails so the timeline does not duplicate that work.

---

## Import flow

`importFiles(files, opts?)` is the entry point for adding local `File` objects. Two
sibling entry points cover the other sources, sharing the same registration and
dedupe-by-`src` logic: `importUrl(url, opts?)` registers a remote/object URL (kind
inferred from the extension or a `HEAD` request), and `importBlob(blob, opts?)`
registers an in-memory `Blob`. Both resolve to a single `MediaAsset`. The local-file
flow is:

```
File[]
  │
  ├─ partitionFiles()          ← synchronous pre-pass
  │    ├─ infer kind from MIME (video/audio/image)
  │    ├─ dedupe by name|size|lastModified
  │    │    ├─ skip if already in store
  │    │    └─ skip if duplicate within the same batch
  │    └─ collect unsupported MIME types into skipped[]
  │
  ├─ Promise.all(importSingleFile)   ← parallel for unique files
  │    ├─ URL.createObjectURL(file) → asset.src
  │    ├─ probe metadata (<video> / <audio> / <img>)
  │    ├─ addAsset() — asset appears immediately (no thumbnail yet)
  │    └─ scheduleThumbnail() — fire-and-forget; updateAsset({ thumbnailUrl })
  │
  └─ return { imported, skipped }
```

### Duplicate detection

Dedupe key: `` `${name}|${size}|${lastModified}` ``

This catches:

- Re-importing the same file in a later session (matched against stored assets).
- Selecting or dropping the same file twice in one batch (matched against a batch-local set before any async work starts).

The synchronous pre-pass avoids a race where parallel `importSingleFile` calls all read an empty store before any `addAsset` completes.

`SkippedImport` entries carry:

| Field | Meaning |
| --- | --- |
| `file` | The original `File` object |
| `reason` | `'duplicate'` or `'unsupported'` |
| `existingAssetId` | Set when the file matches an asset already in the store |

`AssetPanel` reads `skipped` and shows a short inline toast (duplicates as info, unsupported types as warn).

### Thumbnails

Generated on the main thread after the asset is registered:

- **Video** — seek to `min(1, durationSec / 2)`, draw frame to canvas, export JPEG data URL.
- **Image** — load and scale to fit.
- **Audio** — no thumbnail (`thumbnailUrl` stays undefined).

Default max dimension: 240 px (`thumbnailMaxDim` option). Failures are logged and do not block import.

---

## Public API

### Hook (React, from @elah/react)

```ts
const { assets, getAsset } = useMediaLibrary()
```

Returns assets in insertion order (`order` array in the store). Prefer this in components.

### Store (imperative / granular)

```ts
mediaLibraryStore.getState().addAsset(asset)
mediaLibraryStore.getState().updateAsset(id, { thumbnailUrl })
mediaLibraryStore.getState().removeAsset(id)
mediaLibraryStore.getState().getAsset(id)
```

Use for non-React code paths (`importFiles`, workers, actions). Components that need fine-grained subscriptions can select from the store directly.

### Import

```ts
const { imported, skipped } = await importFiles(files, {
  thumbnailMaxDim: 240,  // optional, default 240
  fallbackFps: 30,       // reserved; not used during import yet
})
```

### Probe helpers (exported for reuse / testing)

```ts
probeVideo(src)   // → { durationSec, width, height }
probeAudio(src)   // → { durationSec }
probeImage(src)   // → { durationSec: 0, width, height }
makeVideoThumbnail(src, durationSec, maxDim)
makeImageThumbnail(src, maxDim)
```

### Drag-and-drop contract

When dragging from the Asset panel:

```ts
MEDIA_DRAG_MIME = 'application/x-elah-media'

interface DragMediaPayload {
  kind: 'media-asset'
  assetId: string
}
```

`useTimelineDrop` reads this MIME type, resolves the asset from the store, and creates a clip with `assetId` + `src`.

---

## Lifecycle

Assets are **in-memory only** for now. Object URLs are created at import time and are not yet persisted to IndexedDB/OPFS (Phase 3). Reloading the editor clears the library.

Thumbnail generation is best-effort: the asset is usable immediately after metadata probing; `thumbnailUrl` may appear a moment later via `updateAsset`.

---

## Out of scope (intentionally)

- **Persistence** — no IndexedDB/OPFS yet; assets do not survive reload.
- **`sourceFps` extraction** — deferred (mediabunny / MP4Box.js).
- **Audio waveforms** — `waveform?: Float32Array` placeholder on `MediaAsset`.
- **Content hashing** — dedupe uses name + size + lastModified, not file bytes.
- **Worker/off-thread thumbnails** — all probing and thumbnail work runs on the main thread.

See the `@elah/editor` package's [`Architecture.md`](../../../../editor/src/core/Architecture.md) for how this module fits the wider editor layout.

---

## Testing

```bash
npm --workspace @elah/core run test -- importFiles
```

Tests stub `document.createElement`, `URL.createObjectURL`, and canvas APIs so the suite runs in Node. Coverage includes:

- Registering video, audio, and image assets.
- Skipping unsupported MIME types.
- Async thumbnail patching via `updateAsset`.
- In-batch duplicate rejection.
- Cross-call duplicate rejection against the store.
