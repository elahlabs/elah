# Development Plan — Next Wave

> Status: **proposed**, not yet built. Each doc below is a self-contained
> workstream another developer can pick up. Written against the codebase as of
> branch `dev` (June 2026).

This wave is about turning a working engine + first-pass panels into a **coherent,
composable editor SDK**. The engine layer (decode, render, export, resolve) is
solid; the gaps are now in the *UI/UX seam* and the *developer-facing surface*.

Read [`packages/editor/src/core/Architecture.md`](../../packages/editor/src/core/Architecture.md)
and the `elah-editor-ui` skill before starting — every task here is expected to
**flow with the system grain**, not fight it.

---

## The grain (non-negotiable constraints for every task)

These come straight from the architecture and must hold across all four
workstreams:

- **Package boundaries** — `@elah/core` = engine/state/media model (no UI);
  `@elah/timeline` = timeline UI + drag *consumers*; `@elah/editor` =
  batteries-included **replaceable** components. UI never computes timeline math.
- **Components are replaceable** — every panel takes `style?` + `className?` and
  reads state from public hooks (`useMediaLibrary()`, `useEditor()`). A consumer
  can swap any component for their own and lose nothing. Anything new follows suit.
- **One ingestion funnel** — `importFiles` / `importUrl` / `importBlob` all
  converge on `registerAsset()` → probe → async thumbnails/waveform. New ingestion
  lanes funnel through here; never invent a second path.
- **One drag protocol** — `MEDIA_DRAG_MIME` (`media-asset`) and `ELEMENT_DRAG_MIME`
  (`element`), both consumed by `useTimelineDrop`. Any new draggable defines a
  typed payload in this exact shape and is handled there.
- **Model seam** — imported source media is a `MediaAsset`; generated elements
  (Text, future Draw/Shapes) are **not**. Adjacent in the UI, separate in the model.
- **Engine honesty** — v1 is single video track + single audio track. The UI must
  not imply layering the engine can't place.

---

## Workstreams

| # | Doc | One-line goal |
|---|-----|---------------|
| 1 | [`01-unified-design-system.md`](./01-unified-design-system.md) | Collapse three competing token systems into one CSS-variable source of truth, spanning **every** surface (Preview, Inspector, asset panel, timeline) so a developer can re-theme the whole editor from one place. |
| 2 | [`02-asset-panel-abstraction.md`](./02-asset-panel-abstraction.md) | Let consumers pass media URLs *as-is*; segregate by source + kind on the fly. |
| 3 | [`03-text-editing-and-inspector.md`](./03-text-editing-and-inspector.md) | A real text-editing surface (Inspector) inside the editor, not just the canvas overlay. |
| 4 | [`04-further-findings.md`](./04-further-findings.md) | Consolidation, open decisions (Draw/Shapes), filmstrip view, debt sweep. |

## Suggested sequencing

1. **Start with #1 (design system).** Everything else adds UI; doing it on a
   unified token layer means the new surfaces are themeable from day one instead
   of adding more debt. It also unblocks the live-themeable docs goal.
2. **#2 and #4's panel consolidation together** — they touch the same files
   (`AssetPanel` / `SourcePanel`). Decide the consolidation (#4) first, then build
   the URL/segregation abstraction (#2) on the surviving panel.
3. **#3 (text/Inspector)** can proceed in parallel once #1 lands; it introduces the
   Inspector surface that #4 later generalizes (transform, transitions).

## Cross-cutting acceptance bar

A workstream is done when, in addition to its own criteria:
- no new raw hex (`#rrggbb`) in a component — color/space/radius/type via tokens;
- every new component is replaceable (`style`/`className`, hook-driven);
- every new draggable is handled in `useTimelineDrop`;
- all states are designed (empty / loading / hover / selected / drag / error);
- run the `web-design-guidelines` skill on the rendered markup before merge.
