# 02 — Asset Panel Abstraction

> **Problem (requirement #2):** the end developer using our product should be able
> to pass in media URLs **as-is**, and the **segregation of media should happen on
> the fly.**

## Current state

The engine half is already strong; the gaps are the _consumer-facing API_ and the
_source-lane segregation_.

What exists:

- [`importUrl(url, opts?)`](../../packages/core/src/assets/importFiles.ts) takes a
  URL **as-is** (it becomes the asset `src` — no download/copy), infers kind via
  extension → HEAD `content-type`, dedupes on `src`, funnels through the shared
  `registerAsset()`. This is exactly the "pass URL as-is" primitive.
- Kind segregation on the fly: `inferKind` / `inferKindFromUrl` / `inferKindFromHead`
  classify into `video | audio | image`.
- [`SourcePanel`](../../packages/editor/src/editor/SourcePanel/SourcePanel.tsx)
  already does search / sort / kind-filter chips / grid+list view modes.

What's missing:

1. **No declarative consumer API.** To seed the library a consumer must imperatively
   call `importUrl` per URL after mount. There is no "here are my media URLs, you
   sort it out" entry point on `EditorProvider`.
2. **Segregation is by _kind_ only, not by _source_.** The skill's information
   architecture wants **Axis A = lane (where it came from)** as the _primary_
   grouping (Imported file / URL-remote / Generated element), with **Axis B = kind**
   as a filter _within_ imported media. Today `MediaAsset` has no field recording
   its origin, so source-lane segregation isn't even data-driven.
3. **Two overlapping panels.** `AssetPanel` (older, simple list) and `SourcePanel`
   (newer, lanes + view modes) both exist and are both exported. This must be
   resolved — see [`04-further-findings.md`](./04-further-findings.md#panel-consolidation).
   **This workstream builds on `SourcePanel`; treat `AssetPanel` as deprecated.**

## Target

### A. Model: record provenance (small `@elah/core` change)

Add an `origin` discriminator to `MediaAsset` so segregation-by-source is
data-driven, not guessed in the UI:

```ts
// packages/core/src/assets/types.ts
export type MediaOrigin = 'file' | 'url' | 'blob' // 'generated' stays NON-asset

export interface MediaAsset {
  // …existing…
  origin: MediaOrigin
}
```

Set it in `registerAsset()` callers (`importSingleFile` → `'file'`,
`importUrl` → `'url'`, `importBlob` → `'blob'`). One funnel, one new field —
nothing else in the pipeline changes. This is the seam the panel's lane grouping
reads, and it keeps the **imported `MediaAsset` vs generated element** model seam
intact (generated Text/Draw never get an `origin`; they aren't assets).

### B. Declarative ingestion API (the headline DX win)

Let a consumer pass sources as-is and have the library ingest + segregate them:

```tsx
<EditorProvider
  media={[
    'https://cdn.example.com/intro.mp4',          // bare URL, kind inferred
    'https://cdn.example.com/score.mp3',
    { url: 'https://cdn.example.com/a',            // explicit when inference can't win
      kind: 'video', name: 'Hero' },
  ]}
>
```

Implementation: a thin effect inside the provider that maps each entry to
`importUrl` (the existing funnel) — **no new ingestion path.** Idempotent because
`importUrl` already dedupes on `src`, so re-renders / HMR don't double-import.
Expose an imperative twin for runtime adds: `useMediaLibrary().importUrls(urls)`.

Accept a permissive union so the developer truly passes things "as-is":
`string | { url; kind?; name? }`, and (stretch) raw `File`/`Blob` routed to
`importFiles`/`importBlob`. The point is the developer hands us _sources_; we own
classification.

### C. Panel: lane segregation on the fly

In `SourcePanel`, make **Axis A (source lane) the primary structure** and keep
**Axis B (kind) as the within-imported filter** that already exists:

- Primary lanes (sections, open-ended taxonomy): **Imported** (`origin:'file'`) ·
  **URL / Remote** (`origin:'url'`) · **Elements** (generated — the existing
  Elements lane). Group automatically from `origin`; show a lane only when it has
  content (empty pool still shows the drop affordance).
- Within Imported/URL, keep the kind chips (All / Video / Audio / Image) and
  search/sort.
- The taxonomy must be **open**: adding a future lane = adding a section (+ a MIME
  entry if it's draggable), never reshaping the model.

Per-asset, surface "is this still reachable?" state for URL assets — a remote URL
can 404 or be CORS-blocked. The probe/thumbnail pipeline already fails softly;
reflect that as a per-card **error/offline state** (token-driven), so a dead URL
reads as dead instead of a silently blank thumbnail.

## Tasks

1. **`@elah/core`:** add `MediaOrigin` + `origin` to `MediaAsset`; set it in the
   three `registerAsset` callers; export the type. Update
   [`importFiles.test.ts`](../../packages/core/src/assets/importFiles.test.ts).
2. **`@elah/core`:** add `importUrls(sources)` convenience over `importUrl`, and
   surface it on `useMediaLibrary()`. Define the `MediaSource` input union.
3. **`@elah/editor`:** add a `media?: MediaSource[]` prop to `EditorProvider` that
   ingests on mount (idempotent via existing dedupe).
4. **`@elah/editor`:** restructure `SourcePanel` to group by `origin` (Axis A
   primary) with kind filter inside (Axis B). Lane taxonomy open/data-driven.
5. **States:** design + token the URL-asset error/offline + thumbnail-pending
   states (no layout shift when a remote thumbnail resolves).
6. **Docs:** a "Passing your own media" guide in the web docs (`apps/web/app/docs`)
   showing the declarative prop + the imperative hook.

## Guardrails (grain)

- All ingestion stays on the `importFiles/importUrl/importBlob → registerAsset`
  funnel. **No second ingestion path.**
- Probing/thumbnailing stays async off the render path (it already is) — the
  declarative prop must not block first paint.
- Cross-origin URLs need `crossOrigin="anonymous"` for canvas thumbnails (already
  handled in `loadMediaElement`/`makeImageThumbnail`); document the CORS
  requirement for consumers, since their CDN must allow it.
- Drag-to-timeline still uses `MEDIA_DRAG_MIME` + `DragMediaPayload` unchanged —
  `origin` is metadata, not a new drag lane.

## Acceptance criteria

- [ ] A consumer renders `<EditorProvider media={[ '…url…' ]}>` and the asset
      appears, classified, draggable — with **zero** imperative import calls.
- [ ] Re-render / HMR does not duplicate assets (dedupe holds).
- [ ] `SourcePanel` groups assets by source lane (Imported / URL) with kind filter
      within; adding a hypothetical new lane needs no model change.
- [ ] A dead/CORS-blocked URL renders a clear per-card error state, not a blank.
- [ ] `MediaAsset.origin` is set for every import path and covered by a test.
