# 03 — Text Editing & the Inspector

> **Problem (requirement #3):** a text-editing component should ship _with_ the
> Editor.

## Current state

Text already exists as a first-class clip type, but the only editing surface is the
**canvas overlay**:

- [`TextOverlay.tsx`](../../packages/editor/src/editor/Preview/TextOverlay.tsx)
  gives text click-select, drag-move, corner-drag resize, and double-click inline
  content editing — all on the WebGL stage, writing back through
  `previewClip`/`commitInteraction` (one undo per gesture). This is good and stays.
- The text clip model carries far more than the overlay exposes:
  `content`, `fontSize`, `color`, `fontFamily`, `fontWeight`, `textAlign`, plus a
  typed `TextAnimation` (`TextAnimationKind` is exported from `@elah/core`).
- Dragging the **Text** tile from the Elements lane creates a clip with hardcoded
  defaults (see `dropElement` in
  [`useTimelineDrop.ts`](../../packages/timeline/src/useTimelineDrop.ts):
  `fontSize:200, color:'#ffffff', fontFamily:'sans-serif', …`).

**The gap:** there is **no panel to edit text properties.** A user cannot change
font, color, weight, alignment, or animation — only the literal characters (inline)
and position/size (handles). For a video editor, "text editing" means a properties
surface. That surface does not exist today, for text or anything else.

## Target — introduce the Inspector, text as its first tenant

Build a right-hand **Inspector** panel: a replaceable `@elah/editor` component that
shows controls for the **current selection**, driven entirely by public hooks.
Text is its first (and this workstream's only) tenant; the panel is designed so
transform and transitions can move into it later (see
[`04-further-findings.md`](./04-further-findings.md)).

### Shape

```tsx
export interface InspectorProps { style?: CSSProperties; className?: string }
export function Inspector({ style, className }: InspectorProps) { … }
```

- Reads selection from `useSelectionStore` and the clip from the engine
  (`useTimelineEngine().findClip`) — **no new store**, no duplicated selection
  state. Same source of truth `TextOverlay` already uses.
- Writes through the **same** `previewClip` (live) → `commitInteraction(label)`
  (one undo entry) contract the overlay uses. A color drag = one undo, like a move.
- Selection-aware: text clip → Text section; nothing selected → calm empty state;
  (future) other clip kinds → their sections.

### Text section controls (all already in the model)

| Control     | Field           | Notes                                                                         |
| ----------- | --------------- | ----------------------------------------------------------------------------- |
| Content     | `content`       | Multiline; mirrors/streams like the inline editor (`previewClip`).            |
| Font family | `fontFamily`    | Curated list + the value already on the clip.                                 |
| Font size   | `fontSize`      | Number + drag; the overlay resize already writes this — keep them consistent. |
| Weight      | `fontWeight`    | normal / bold (model is a string).                                            |
| Color       | `color`         | Picker; **one** undo per commit, not per pixel.                               |
| Alignment   | `textAlign`     | left / center / right.                                                        |
| Animation   | `TextAnimation` | Use the exported `TextAnimationKind`; wire the existing enum, don't invent.   |

### Interaction parity (don't fork the truth)

The Inspector and `TextOverlay` edit the _same_ clip via the _same_ engine calls.
Changing `fontSize` in the Inspector must move the on-canvas handles, and vice
versa, because both read resolved scene state — verify this explicitly. Do **not**
add a second text-state store to back the panel.

## Tasks

1. **`Inspector` component** in `packages/editor/src/editor/Inspector/`, exported
   from the editor entry, selection-driven, empty-state designed, fully tokenized.
   The Inspector is an explicit surface in the unified token contract
   ([`01` § surface coverage](./01-unified-design-system.md#surface-coverage--the-token-contract-spans-the-whole-editor)):
   build it on `--elah-*` from the first commit so a developer re-themes it from
   the same `.elah-root` knobs as Preview, the asset panel, and the timeline — no
   raw hex, ever.
2. **Text section** with the seven controls above, each routed through
   `previewClip` → `commitInteraction('Edit text …')` for clean single-entry undo.
3. **Live-edit content** in the Inspector that interoperates with the inline
   overlay editor (shared engine writes; no conflicting `editingId` ownership).
4. **Promote drop defaults** — the hardcoded text defaults in `dropElement` should
   come from one shared `defaultTextStyle` so the drop and the Inspector agree.
5. **A11y/keyboard** — labelled controls, focus order, ESC/Enter semantics
   consistent with the inline editor; run `web-design-guidelines`.

## Guardrails (grain)

- Inspector lives in `@elah/editor`, is replaceable (`style`/`className`), reads
  state via hooks — a consumer can swap it for their own and lose nothing.
- **Model seam holds:** the Inspector edits whatever the selection _is_. Text is a
  text clip (generated element lineage); it is not a `MediaAsset`. Don't blur that.
- All writes go through the engine's preview/commit interaction API so undo/redo
  and export parity come for free. No direct store mutation.

## Acceptance criteria

- [ ] Selecting a text clip shows an Inspector with all seven controls populated
      from the clip's current values.
- [ ] Editing any property updates the canvas live and lands as exactly **one**
      undo entry per gesture/commit.
- [ ] Inspector ↔ inline overlay stay in sync (no divergent state); changing size
      in one moves the handles in the other.
- [ ] Nothing-selected shows a designed empty state, not a blank box.
- [ ] Component is replaceable and contains no raw hex.
