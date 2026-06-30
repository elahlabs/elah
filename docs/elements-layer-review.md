# Elements Layer — Code Review Findings

Branch: `dev` | Reviewed: 2026-06-30 | Effort: medium

This review covers the elements layer PR: shape (rect/circle/triangle) and freehand clip types, GPU rendering layers, ShapeOverlay, drag-drop wiring, and the TrackKind rename from `'text'` to `'elements'`.

---

## Correctness bugs — fix before ship

### 1. TrackKind migration break: text clips render under video in loaded projects

**File:** `packages/core/src/resolver/resolveTimeline.ts:108`

```ts
// Before
const zIndex = track.kind === 'text' ? 1000000 : (maxOrder - track.order) * 1000
// After
const zIndex = track.kind === 'elements' ? 1000000 : (maxOrder - track.order) * 1000
```

Any persisted project with a track that has `kind: 'text'` (the old value) will load without error but receive a low order-based zIndex instead of 1000000. Text clips will render **beneath** video clips. There is no migration code and `TimelineEngine.ts` has no version upgrade path.

**Fix:** Add a load-time migration that converts `kind: 'text'` → `kind: 'elements'` on deserialized project data, or add a fallback in the zIndex line:

```ts
const isElementsTrack = track.kind === 'elements' || track.kind === ('text' as string)
const zIndex = isElementsTrack ? 1000000 : (maxOrder - track.order) * 1000
```

---

### 2. `scene.shapes` and `scene.freehand` not depth-sorted

**File:** `packages/core/src/resolver/resolveTimeline.ts:388–391`

```ts
scene.videos.sort(byDepth)
scene.audios.sort(byDepth)
scene.texts.sort(byDepth)
scene.images.sort(byDepth)
// scene.shapes and scene.freehand are NOT sorted
```

When two shape clips from different elements tracks are active at the same frame, they render in clip array insertion order rather than by track depth.

**Fix:** Add:
```ts
scene.shapes.sort(byDepth)
scene.freehand.sort(byDepth)
```

---

### 3. All elements tracks get identical zIndex=1000000

**File:** `packages/core/src/resolver/resolveTimeline.ts:108`

Every elements track receives the same fixed value regardless of `track.order`. Two elements tracks can never be depth-ordered relative to each other. This compounds finding 2 — even after adding the sort, all shapes will have the same zIndex and order remains undefined.

**Fix:** Give elements tracks a zIndex range above video, e.g.:
```ts
const zIndex = track.kind === 'elements'
  ? 1000000 + (maxOrder - track.order)
  : (maxOrder - track.order) * 1000
```

---

### 4. Solo pre-pass bypassed for legacy `kind: 'text'` tracks

**File:** `packages/core/src/resolver/resolveTimeline.ts:103`

```ts
if (hasSolo[track.kind as 'video' | 'audio' | 'elements'] && !track.solo) continue
```

The `as` cast is erased at runtime. When `track.kind === 'text'`, this evaluates as `hasSolo['text']` which is `undefined` (key doesn't exist). The condition is falsy so the track is never excluded — old text-kind tracks ignore solo even when another elements track is solo'd.

**Fix:** Covered by the same migration fix as finding 1. Once all tracks are migrated to `kind: 'elements'`, this is moot.

---

## Design / maintenance debt

### 5. `ShapeVariant` defined independently in two packages

**Files:** `packages/core/src/types/index.ts:44` and `packages/timeline/src/elementDrag.ts:15`

Both define `ShapeVariant = 'rect' | 'circle' | 'triangle'` independently with no import link. TypeScript accepts them today via structural compatibility. If a new variant is added to `@elah/core` but not `@elah/timeline`, it becomes unreachable via drag-drop with no compile error at the drag source.

**Fix:** Remove the definition from `elementDrag.ts` and import it from `@elah/core`:
```ts
import type { ShapeVariant } from '@elah/core'
export type { ShapeVariant }  // re-export so existing consumers don't break
```

---

### 6. `shapeAnimation?: TextAnimation` leaks text-specific type name into shape API

**File:** `packages/core/src/types/index.ts:118`

`TextAnimation` and `TextAnimationKind` are already imported in `ShapeClipProperties.tsx` to configure shape animation. If `TextAnimation` gains text-only fields, or if shape clips need their own animation kinds (`'grow'`, `'spin'`), the field type must change and all persisted projects need migration.

**Fix:** Add a `ShapeAnimation` type alias (or distinct type) in `types/index.ts` and use it for `Clip.shapeAnimation`. Today it can be identical to `TextAnimation`; the separation prevents future coupling.

---

### 7. `ShapeLayer` and `FreehandLayer` are fully duplicated

**Files:** `packages/core/src/renderer/gpu/layers/ShapeLayer.ts` and `FreehandLayer.ts`

The two classes share identical `ItemResources`, `_program`/`_vao`/`_gl`/`_resources` fields, and the full `acquire`/`release`/`draw`/`dispose`/`notifyContextLost`/`_ensurePipeline` lifecycle. Only the paint function differs. Any bug fixed in one must be manually mirrored to the other.

Additionally, both allocate a VAO that the quad vertex shader never uses (`quad.vert` is `gl_VertexID`-only with no vertex attributes) — a dead state-switch on every draw call.

**Fix:** Extract a `Canvas2DQuadLayer<T>` base class that takes a `paint(ctx2d, item, stage)` callback and a `signature(item, stage): string` function. `ShapeLayer` and `FreehandLayer` become thin subclasses. Remove the VAO from the base.

---

### 8. `FreehandIcon` dead component + missing freehand tile in `ElementsPanel`

**File:** `packages/editor/src/editor/ElementsPanel/ElementsPanel.tsx:35`

`FreehandIcon` is defined at line 35 but never referenced in `TILES`. The freehand palette entry exists in `SourcePanel` but is absent from `ElementsPanel`, so users of the standalone `ElementsPanel` cannot drag a freehand clip to the timeline.

**Fix:** Either add the freehand tile to `TILES` (matching the `SourcePanel` entry) or delete `FreehandIcon` if the decision is to exclude freehand from this panel intentionally.

---

## Quick-fix checklist

- [ ] Add `scene.shapes.sort(byDepth)` and `scene.freehand.sort(byDepth)` after line 391 in `resolveTimeline.ts`
- [ ] Fix elements track zIndex to use `1000000 + (maxOrder - track.order)` so tracks can be depth-ordered
- [ ] Add load-time migration: `kind: 'text'` → `kind: 'elements'`
- [ ] Remove `ShapeVariant` from `elementDrag.ts`; import from `@elah/core`
- [ ] Add/resolve freehand tile in `ElementsPanel` (add or delete `FreehandIcon`)
- [ ] (Larger) Extract `Canvas2DQuadLayer` base; remove duplicate GPU boilerplate
- [ ] (Larger) Add `ShapeAnimation` type alias; decouple from `TextAnimation`
