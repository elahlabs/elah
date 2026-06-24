# 04 — Further Findings & Open Decisions

> **Requirement #4: "whatever you find further."** These surfaced while reading the
> code for #1–#3. Ordered by leverage. Some are tasks; some are **decisions that
> must be made before the related code is written.**

---

## Panel consolidation (do this first — #2 depends on it) {#panel-consolidation}

There are **two media panels**, both exported from
[`packages/editor/src/index.ts`](../../packages/editor/src/index.ts):

- [`AssetPanel`](../../packages/editor/src/editor/AssetPanel/AssetPanel.tsx) —
  older: flat list, browse/drop/URL, delete. ~580 lines.
- [`SourcePanel`](../../packages/editor/src/editor/SourcePanel/SourcePanel.tsx) —
  newer: `Media | Elements` lanes, grid/list view modes, search/sort/kind chips.
  Supersedes `AssetPanel` and also subsumes
  [`ElementsPanel`](../../packages/editor/src/editor/ElementsPanel/ElementsPanel.tsx).

They duplicate the ingestion logic, the `ClipCard`/`AssetThumbnail`, the toast
builder, and the context menu — three copies that will drift.

**Recommendation:** make `SourcePanel` the one panel. Mark `AssetPanel` and
`ElementsPanel` deprecated (keep the exports one minor for consumers, with a JSDoc
`@deprecated` pointing at `SourcePanel`), then remove. All of [`02`](./02-asset-panel-abstraction.md)
builds on `SourcePanel`. **Decision needed from Paul:** hard-remove now, or
deprecate-then-remove? (Recommend deprecate-then-remove since the components are
public API.)

---

## DECISION REQUIRED: Draw / Shapes — element or image-asset? {#draw-decision}

The skill flags this as something that must not stay ambiguous, and it forks the
implementation. Two options:

- **(a) Generated element** — new `ElementKind` (`'draw' | 'shape'`), new
  `ELEMENT_DRAG_MIME` payload entry, handled in `dropElement` /
  [`useTimelineDrop`](../../packages/timeline/src/useTimelineDrop.ts). Lives in the
  Elements lane next to Text. **Stays vector/editable.** Implies a renderer layer
  for the shape.
- **(b) Image `MediaAsset`** — a draw tool rasterizes to a blob, funnels through
  `importBlob`, lands in the media pool as an `image`. Reuses the entire existing
  media path; **loses editability** after creation.

These imply different homes (Elements vs Media), different drag lanes, and
different renderer work. **Pick one before any Draw code is written.** Recommend
**(a)** for Shapes (they're parametric like Text) and **(b)** for freehand Draw
(rasterized) — but that's the decision to confirm. Capture the outcome in
`ROADMAP.md`'s decisions log.

When Draw/Shapes ships as an element, it **must** follow the drag contract: define
the MIME payload in the `DragElementPayload` shape and handle it in `useTimelineDrop`
— same as Text.

---

## Inspector generalization (follow-on to #3) {#inspector}

[`03`](./03-text-editing-and-inspector.md) introduces the Inspector for text. Two
other surfaces are currently edited ad-hoc and are natural Inspector tenants:

- **Transform** — video/image position/scale live only in
  [`MediaTransformOverlay`](../../packages/editor/src/editor/Preview/MediaTransformOverlay.tsx)
  (drag + corner scale). No numeric inputs, no rotation handle (ROADMAP backlog
  notes `transform.rotation` already flows through both renderers — the handle is
  the only missing piece). An Inspector transform section gives precise X/Y/scale/
  rotation.
- **Transitions** — edited via the timeline
  [`TransitionPicker`](../../packages/timeline/src/TransitionPicker.tsx) popover.
  Could surface duration/kind/easing in the Inspector when a transition is selected.

Build these only after the text Inspector proves the pattern. Same rules: hook-
driven, `previewClip`/`commitInteraction`, replaceable, tokenized.

---

## Filmstrip view mode is declared but not built {#filmstrip}

`SourcePanel`'s `ViewMode` is `'grid' | 'list'`, but the skill's reference (and the
panel's own doc-comment) call for a third **filmstrip / hover-scrub** view. The
**data is already there**: `MediaAsset.thumbnailStrip` (evenly-spaced frames) and
`waveform` are generated on import and currently used only by the timeline
`ClipBlock`. A filmstrip/hover-scrub view in the pool is largely a rendering task,
not a data task. Add `'filmstrip'` to `ViewMode` and sweep `thumbnailStrip` on
hover to preview frames.

---

## Smaller items / debt

- **Raw-hex debt beyond colors** — tracked in [`01`](./01-unified-design-system.md):
  toast literals in `AssetPanel`/`SourcePanel`, selection chrome (`#4c9aff`,`#fff`)
  in `TextOverlay`. Fold the fix into the design-system sweep.
- **View-mode + density persistence — DECISION NEEDED.** `SourcePanel` resets
  `viewMode`/`kindFilter`/`sort` on every mount. Decide: persist per-editor (prop
  default) vs local persistence (localStorage). The skill leaves this open;
  recommend a `defaultView`/`defaultDensity` prop *plus* optional local persistence.
- **Density token** — ship a calm default, expose `comfortable | compact` via the
  token layer once [`01`](./01-unified-design-system.md) lands.
- **Elements-lane search is a no-op** — `SourcePanel` renders a "Search elements…"
  input that isn't wired. Either wire it or remove it (it reads as broken).
- **Engine honesty** — as new draggable surfaces land, keep the UI within the v1
  single-video / single-audio reality; don't render multi-layer affordances the
  engine can't place.

---

## Decisions to record in `ROADMAP.md` once made

1. Panel consolidation: deprecate-then-remove `AssetPanel`/`ElementsPanel`.
2. Draw vs Shapes: element (vector) vs image-asset (raster) — per surface.
3. View-mode/density persistence location.
4. Design-token single source = CSS variables (`tokens.css`); `timelineTheme`
   becomes a typed read-facade (from [`01`](./01-unified-design-system.md)).
