# References

> Reading guide for related open-source editors. Use these to learn patterns, not to copy code.

---

## 1. This project — `MyEditorPackage/packages/timeline`

**Goal:** Solidify the baseline: engine-first, Immer history, frame-based clips, thin React UI.

| Order | File | Why read it |
|------|------|-------------|
| 1 | `packages/timeline/src/core/editor/TimelineEngine.ts` | Single mutation funnel (`commit`), undo/redo, events, all public ops |
| 2 | `packages/timeline/src/types/index.ts` | `Project`, `Track`, `Clip`, `EngineEvent` — data contract |
| 3 | `packages/timeline/src/core/playback/PlaybackEngine.ts` | RAF clock + subscribe model |
| 4 | `packages/timeline/src/core/resolver/resolveTimeline.ts` | Pure resolver — the most important function |
| 5 | `packages/timeline/src/core/resolver/scene.ts` | Scene output types — renderer contract |
| 6 | `packages/timeline/src/core/visitor/add.ts`, `remove.ts`, `update.ts`, `split.ts`, `clone.ts` | How edits apply to the draft project |
| 7 | `packages/timeline/src/core/elements/base.ts` + `video.ts` / `audio.ts` / … | Clip construction and typed payloads |
| 8 | `packages/timeline/src/utils/frames.ts`, `snap.ts` | Time math, snapping |
| 9 | `packages/timeline/src/ui/Timeline.tsx` | Engine ↔ Zustand sync, keyboard shortcuts, zoom |
| 10 | `packages/timeline/src/ui/engine-context.ts` | `useTimeline()` pattern |
| 11 | `packages/timeline/src/stores/tracks.store.ts`, `playback.store.ts`, `selection.store.ts` | What the UI subscribes to |
| 12 | `packages/timeline/src/ui/TrackRow.tsx`, `ClipBlock.tsx`, `Ruler.tsx`, `Playhead.tsx` | Interaction surface |
| 13 | `packages/timeline/src/index.ts` | Public API surface |

**Strengths to preserve:** Framework-agnostic core, structural sharing via Immer, typed events, clear separation from React.

**Known gaps (see [`ROADMAP.md`](../ROADMAP.md)):** asset registry, preview renderer, media gallery, text overlay rendering, transitions/effects/animations, export pipeline.

---

## 2. Twick — `ReferenceProjects/twick`

**Goal:** See a production NLE-style integration: OOP elements, visitors, global store, JSON undo, live player bus.

### Package `@twick/timeline`

| Order | File | Why read it |
|------|------|-------------|
| 1 | `packages/timeline/src/core/editor/timeline.editor.ts` | Large API: batch updates, ripple delete, migrations, watermark, transitions |
| 2 | `packages/timeline/src/core/track/track.ts`, `track.friend.ts` | Track model + mutation helpers |
| 3 | `packages/timeline/src/core/elements/base.element.ts` | Element base; compare to your plain `Clip` records |
| 4 | `packages/timeline/src/core/visitor/element-adder.ts`, `element-remover.ts`, `element-updater.ts`, `element-splitter.ts`, `element-cloner.ts` | Visitor pattern end-to-end |
| 5 | `packages/timeline/src/services/data.service.ts` | `TimelineContextStore` — keyed timeline instances |
| 6 | `packages/timeline/src/context/timeline-context.tsx` | React provider: editor, selection, `setTimelineAction`, duration |
| 7 | `packages/timeline/src/context/undo-redo-context.tsx` | `ProjectJSON` stacks + optional localStorage |
| 8 | `packages/timeline/src/types/index.ts` (and `types.ts`) | Serialized shapes |

### App glue (`video-editor`)

| Order | File | Why read it |
|------|------|-------------|
| 1 | `packages/video-editor/src/components/timeline/timeline-manager.tsx` | Drop, collision → new track, editor calls |
| 2 | `packages/video-editor/src/hooks/use-timeline-manager.tsx` | Drag, multi-select batch `updateElements`, trim with playback rate |
| 3 | `packages/video-editor/src/components/timeline/timeline-view.tsx` | Presentation + interaction wiring |

**Contrast with this project:** Twick favors **rich runtime objects** + **JSON snapshot** undo; we favor **immutable `Project`** + **Immer patches**. Twick is tightly coupled to **player actions** and a **singleton store**; our engine stays **embeddable**.

---

## 3. Freecut — `ReferenceProjects/freecut`

**Goal:** See scaled architecture: many Zustand domains, command undo, huge `utils/` for timeline behavior, WebGPU compositor, AudioContext clock.

### Types & persistence

| Order | File | Why read it |
|------|------|-------------|
| 1 | `src/types/project.ts` | `ProjectTimeline` — tracks + items shape (persistence-oriented) |
| 2 | `src/types/timeline.ts` | Rich discriminated timeline items (video/audio/text/…) |
| 3 | `src/features/timeline/stores/timeline-persistence.ts` | Load/save, sanitization, repairs |

### State architecture

| Order | File | Why read it |
|------|------|-------------|
| 1 | `src/features/timeline/stores/timeline-store.ts` | Points to facade |
| 2 | `src/features/timeline/stores/timeline-store-facade.ts` | Combined snapshot for React (`useSyncExternalStore`), domain store merge |
| 3 | `src/features/timeline/stores/items-store.ts` | Tracks + items (start here for "where does clip data live?") |
| 4 | `src/features/timeline/stores/timeline-command-store.ts` | Undo/redo command stack |
| 5 | `src/features/timeline/stores/timeline-settings-store.ts` | FPS, snap, scroll |
| 6 | `src/features/timeline/timeline-actions` (directory) | Cross-domain mutations |

### Playback & rendering (the gold mine)

| Order | File | Why read it |
|------|------|-------------|
| 1 | `src/features/player/clock/Clock.ts` | **RAF + AudioContext-grounded clock — copy this pattern** |
| 2 | `src/features/composition-runtime/utils/scene-assembly.ts` | `resolveCompositionRenderPlan` — their resolver |
| 3 | `src/features/player/video/VideoSourcePool.ts` | `<video>` element pool keyed by URL |
| 4 | `src/features/composition-runtime/compositions/main-composition.tsx` | DOM stack + GPU overlay composition |
| 5 | `src/features/export/utils/canvas-render-orchestrator.ts` | In-browser export via mediabunny + WebGPU |

### Behavior samples (pick by feature)

| Area | Example files |
|------|----------------|
| Drag / snap | `src/features/timeline/utils/track-content-drag.ts`, `timeline-snap-utils.ts` |
| Layout | `src/features/timeline/utils/timeline-layout.ts` |
| Linked A/V | `src/features/timeline/utils/linked-items.ts`, `linked-drag-targeting.ts` |
| Transitions | `src/features/timeline/utils/transition-utils.ts`, `transition-chain-store.ts` |

**Contrast with this project:** Freecut splits state across many stores and uses a facade for a stable React API; our design keeps one engine + one project. Freecut is the reference if you need **feature breadth** (tools, transitions, markers, keyframes) and **production polish** (AudioContext clock, GPU compositor, mediabunny export).

---

## 4. xzdarcy/react-timeline-editor — `ReferenceProjects/react-timeline-editor`

**Goal:** Study animation-style timelines: rows/actions, effect callbacks, separate playback engine, interact.js drag/resize.

### Engine (framework-agnostic)

| Order | File | Why read it |
|------|------|-------------|
| 1 | `packages/engine/src/interface/action.ts` | `TimelineRow`, `TimelineAction` (`start`/`end`/`effectId`) |
| 2 | `packages/engine/src/interface/effect.ts` | Effect lifecycle: `enter` / `update` / `leave` / … |
| 3 | `packages/engine/src/core/engine.ts` | `TimelineEngine`: time, play/pause, `data` sync, action walk |
| 4 | `packages/engine/src/core/events.ts`, `emitter.ts` | Event model |

### React editor

| Order | File | Why read it |
|------|------|-------------|
| 1 | `packages/timeline/src/interface/timeline.ts` | `EditData`, `TimelineState`, props/callbacks |
| 2 | `packages/timeline/src/components/timeline.tsx` | Engine ref, `onChange`, cursor, scroll sync |
| 3 | `packages/timeline/src/utils/deal_data.ts` | Pixel ↔ time |
| 4 | `packages/timeline/src/components/edit_area/edit_area.tsx`, `edit_action.tsx` | Row/action rendering |
| 5 | `packages/timeline/src/components/row_rnd/interactable.tsx` | Drag/resize mechanics |

**Contrast with this project:** Optimized for keyframed effects and preview playback, not NLE source trim / tracks / media library. Borrow interaction patterns (snap lines, auto-scroll, virtualized list) more than the data model.

---

## 5. Comparison matrix (at a glance)

| Topic | This project | Twick | Freecut | react-timeline-editor |
|--------|-------------|-------|---------|------------------------|
| **Core unit** | `TimelineEngine` + `Project` | `TimelineEditor` + `Track`/`TrackElement` | Facade + domain Zustand stores | `TimelineEngine` + `TimelineRow[]` |
| **Clip model** | Plain `Clip` in `project.clips[trackId]` | Class hierarchy + visitors | Plain items in `items` array | `TimelineAction` on rows |
| **Time** | Frames (`fps`) | Seconds on elements | Frames (`from`, `durationInFrames`) | Abstract `start`/`end` numbers |
| **Undo** | Immer `prev`/`next` entries | JSON deep clone stacks | Command / snapshot store | App responsibility |
| **React coupling** | Low (optional UI) | High (context, player) | Medium (many hooks/stores) | High (editor component) |
| **Playback clock** | `PlaybackEngine` (RAF, planned AudioContext) | Delegated to `@twick/core` (external) | `Clock` (RAF + AudioContext) | Built-in effect runner |
| **Resolver** | Pure `resolveTimeline` | `getCurrentElements` (linear scan) | `resolveCompositionRenderPlan` (composed) | Action walk in engine |
| **Best steal for this project** | — | Batch ops, validation errors | AudioContext clock, video pool, GPU export | Drag UX, virtualization, time↔pixel |

---

## 6. Suggested reading order (one pass)

1. **This project:** `TimelineEngine.ts` → `PlaybackEngine.ts` → `resolveTimeline.ts` → `Timeline.tsx` → `ClipBlock.tsx`
2. **Twick:** `timeline-context.tsx` → `timeline.editor.ts` (skim methods) → `use-timeline-manager.tsx`
3. **Freecut:** `Clock.ts` → `scene-assembly.ts` → `VideoSourcePool.ts` → `timeline-store-facade.ts` → `items-store.ts` → one drag util
4. **react-timeline-editor:** `engine.ts` → `timeline.tsx` → `edit_action.tsx` → `interactable.tsx`

---

## 7. Patterns worth borrowing (mapped to references)

| Improvement | Where to learn |
|-------------|----------------|
| AudioContext-grounded clock | Freecut `Clock.ts` (the `_now()` method) |
| `<video>` element pool keyed by URL | Freecut `VideoSourcePool.ts` |
| Native HTML5 DnD with structured MIME | Freecut `timeline-track.tsx`, `timeline-media-drop-zone.tsx` |
| Multi-clip drag + collision policy | Twick `use-timeline-manager.tsx`; Freecut `linked-drag-targeting.ts` |
| Stronger snap (playhead, clips, grid) | Freecut `timeline-snap-utils.ts` |
| Virtualized rows for many tracks | react-timeline-editor `ScrollSync` / react-virtualized usage |
| Ripple / roll edits | Twick `rippleDelete`; Freecut slip/slide utils |
| Transitions between clips | Twick `addTransition`; Freecut `transition-utils.ts` |
| Persistence + versioning | Twick `migrations.ts`; Freecut `timeline-persistence.ts` |
| Optional effect preview runner | react-timeline-editor `TimelineEngine` effect `enter`/`update`/`leave` |
| In-browser export pipeline | Freecut `canvas-render-orchestrator.ts` (mediabunny + WebGPU) |
| WebCodecs export | Twick `@twick/browser-render` |

---

*Update paths if you move sibling repos. Originally located at `MyEditorPackage/Nextsteps.md`; now at `docs/references.md`.*
