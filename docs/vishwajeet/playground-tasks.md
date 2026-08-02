# Playground Tasks — Vishwajeet

Tasks for improving the two playground views: `/playground/timeline` (Timeline-only) and the left panel in `/playground/production` (Production Editor).

---

## Overview — What We're Building

```mermaid
flowchart LR
  subgraph TLP["Timeline Playground  /playground/timeline"]
    direction TB
    T1["Toolbar"] --> T2["Config Panel + Timeline + JSON Output"]
  end

  subgraph PE["Production Editor  /playground/production"]
    direction TB
    P1["AppHeader"] --> P2["Left Rail + Side Panel + Preview + TextProps"]
    P2 --> P3["TimelineControls + Timeline"]
  end

  TLP -->|"Tasks 1 & 2"| NewA["Add Config Panel\nEnable classNames\nShow resolveTimeline JSON"]
  PE  -->|"Task 3"| NewB["Add JSON rail item\nLiveJsonPanel updates\non every edit"]
```

---

## Task 1 — Enable All UI Configs on the Timeline Playground

**File:** `apps/web/components/playground/timeline/TimelineEditor.tsx`

The `<Timeline>` component accepts a `classNames` prop (`TimelineClassNames`) and the wrapping `<EditorProvider>` has additional configuration props. None of these are currently wired up in the playground — everything uses defaults. Add UI controls to let users toggle/tweak each config live.

### Timeline `classNames` slots to expose

These map to the `classNames` prop on `<Timeline>` (type: `TimelineClassNames` from `@elah/timeline`):

| Slot | Controls | Description |
|---|---|---|
| `root` | free-form class input | Outer wrapper (e.g. `rounded-xl`) |
| `ruler` | color picker / preset classes | Ruler strip background |
| `rulerTick` | color picker / preset classes | Tick marks in the ruler |
| `rulerLabel` | color picker / preset classes | Timecode labels |
| `track` | free-form class input | Each track row container |
| `trackLabel` | free-form class input | Track-label sidebar per row |
| `lane` | color picker / preset classes | Clip lane background |
| `clip` | free-form class input | Clip block shape/shadow (all types) |
| `clipVideo` | gradient preset | Video clip body gradient (`from-* to-*`) |
| `clipAudio` | gradient preset | Audio clip body gradient |
| `clipText` | gradient preset | Text clip body gradient |
| `clipImage` | gradient preset | Image clip body gradient |
| `clipVideoAccent` | color text class | Video clip stripe + selected border |
| `clipAudioAccent` | color text class | Audio clip accent |
| `clipTextAccent` | color text class | Text clip accent |
| `clipImageAccent` | color text class | Image clip accent |
| `playhead` | color text class | Playhead needle color (uses `currentColor`) |

> **Note on color slots:** Clip bodies take a `from-*/to-*` gradient or `bg-*`. Accent/playhead slots take a `text-*` class since those elements paint from `currentColor`.

### `EditorProvider` configs to expose

These are props on `<EditorProvider>`:

| Prop | Type | Default | Description |
|---|---|---|---|
| `defaultTrackHeight` | `number` | 36 | Height in px of each track row |
| `maxHistorySize` | `number` | engine default | Max undo history entries |
| `stage.width` / `stage.height` | `number` | 1920 × 1080 | Canvas/stage dimensions |

Because `EditorProvider` memoizes the engine once on mount, `stage`, `defaultTrackHeight`, and `maxHistorySize` can only be applied on mount. Wire these as controls that require a remount (show a "Remount to apply" note next to them, or implement a key-based remount).

### Suggested UI layout

Add a collapsible config panel (sidebar or drawer) next to the timeline area. Group controls into three sections:

1. **Provider Config** — `defaultTrackHeight`, `maxHistorySize`, stage size (with remount warning)
2. **Timeline classNames** — one input/picker per slot above, live-applied
3. **Zoom** — the zoom slider already exists in the toolbar; keep it there

Apply `classNames` changes live by passing them as state to the `<Timeline classNames={...} />` prop — no remount needed.

```mermaid
flowchart TB
  subgraph TLP["Timeline Playground — /playground/timeline"]
    direction TB

    Toolbar["▶ Play · ⏮ Reset · ↶ Undo · + Video · + Audio · + Text · ✕ Clear"]

    subgraph Workspace["Workspace"]
      direction LR

      subgraph Config["Config Panel  ← NEW"]
        direction TB
        EP["EditorProvider Props
        ──────────────────
        defaultTrackHeight
        maxHistorySize
        stage w × h
        ⚠ requires remount"]
        CN["Timeline classNames
        ──────────────────
        ruler / rulerTick / rulerLabel
        track / trackLabel / lane
        clip / clipVideo / clipAudio
        clipText / clipImage
        accents / playhead
        (applied live, no remount)"]
        EP --- CN
      end

      subgraph Right["Right Area"]
        direction TB
        TL["Timeline  ← classNames applied live
        ──────────────────────────────────
        00:00     00:05     00:10
        Video  ░░░░░░░      ░░░░░░
        Audio      ░░░░░░░░░
        Text   ░░░░░"]

        JSON["resolveTimeline JSON Output  ← NEW
        ──────────────────────────────────
        { frame: 42, fps: 30,
          videos: [{ id, src, zIndex }],
          texts:  [{ content: 'Hello' }],
          audios: [], images: [] }
        scrollable · updates every frame"]

        TL --> JSON
      end
    end

    Toolbar --> Workspace
  end
```

---

## Task 2 — Show `resolveTimeline` JSON Output (Timeline Playground)

**File:** `apps/web/components/playground/timeline/TimelineEditor.tsx`

Currently there is no output panel. Instead of adding a preview screen (no renderer is wired in the timeline playground), show the live JSON output of `resolveTimeline`.

### What `resolveTimeline` returns

```ts
// packages/core/src/resolver/resolveTimeline.ts
resolveTimeline(frame: number, project: Project): Scene
```

The `Scene` shape:
```ts
{
  frame: number
  fps: number
  stage: { width: number; height: number }
  videos: ActiveVideoClip[]    // clips active at this frame
  audios: ActiveAudioClip[]
  texts:  ActiveTextClip[]
  images: ActiveImageClip[]
  shapes: ActiveShapeClip[]
  freehand: ActiveFreehandClip[]
  transitions: ActiveTransition[]
}
```

### Data flow

```mermaid
flowchart LR
  PB["PlaybackStore
  currentFrame"] --> RT
  TS["TracksStore
  tracks / clips"] --> GT["engine.getProject()"]
  GT --> RT["resolveTimeline
  (frame, project)"]

  RT --> Scene["Scene {
  frame, fps, stage
  videos[]
  audios[]
  texts[]
  images[]
  transitions[]
  }"]

  Scene -->|"Task 2: per frame
  tick during playback"| J1["TimelineEditor
  JSON panel"]

  Scene -->|"Task 3: on every
  track or clip edit"| J2["LiveJsonPanel
  ProductionEditor"]

  Scene -->|"existing: per
  RAF tick"| GPU["GPU Renderer
  → canvas"]
```

### Implementation

- Import `resolveTimeline` from `@elah/core`
- Subscribe to `usePlaybackStore` for `currentFrame` and `useTracksStore` for the project (call `engine.getProject()`)
- On every frame tick, call `resolveTimeline(currentFrame, engine.getProject())` and store in state
- Render the JSON in a scrollable panel below (or to the right of) the timeline

```tsx
// Rough shape — adapt to fit layout
const scene = resolveTimeline(currentFrame, engine.getProject())
<pre className="text-xs font-mono overflow-auto">
  {JSON.stringify(scene, null, 2)}
</pre>
```

**When to update:** Subscribe to `usePlaybackStore` so it updates every frame during playback. Also update on any `useTracksStore` change (clip add/remove/move).

> The output fires on play — the JSON should animate as the frame advances and clips enter/leave the scene.

---

## Task 3 — Live JSON Output for the Left Panel (Production Editor)

**File:** `apps/web/components/playground/production/ProductionEditor.tsx`

Mirror Task 2, but for the Production Editor's left panel. Instead of firing only on play, the JSON should update **continuously** as the user edits — whenever tracks, clips, or their properties change.

### Where to show it

The left panel currently hosts `<MediaPanel>` or `<ElementsPanel>` depending on the active left-rail item (Media / Stock / Photos / Audio / Text). Add a new rail item — e.g. **"JSON"** with a `Code2` or `Braces` icon — that swaps the panel to a JSON viewer.

```mermaid
flowchart TB
  subgraph PE["Production Editor — /playground/production"]
    direction TB

    Header["← Playgrounds · elah · ✦ Load Demo · ↶ Undo  ↷ Redo · Export · Tabs · GitHub"]

    subgraph Body["Body"]
      direction LR

      subgraph Rail["Left Rail  68px"]
        direction TB
        RM["☁ Media"]
        RS["🎬 Stock"]
        RP["🖼 Photos"]
        RA["🎵 Audio"]
        RT["T  Text"]
        RJ["{ }  JSON  ← NEW"]
      end

      subgraph Panel["Side Panel  240px"]
        MP["MediaPanel
        (default / media rail)"]
        ELP["ElementsPanel
        (text rail)"]
        LJP["LiveJsonPanel  ← NEW
        ────────────────────
        resolveTimeline JSON
        updates on every edit
        (drag, trim, add, remove)"]
      end

      subgraph Center["Center"]
        direction TB
        AC["16:9 · 9:16 · 1:1  aspect selector"]
        PV["GPU Preview Canvas"]
        TB2["◀  ▶  ⏹   00:00:00 | 00:30:00   Fit"]
        AC --> PV --> TB2
      end

      TXP["TextClip
      Properties
      300px
      (shown when
      text clip
      selected)"]

      RJ -->|"active"| LJP
      RT -->|"active"| ELP
      RM -->|"active"| MP
    end

    subgraph Bottom["Bottom"]
      TC["+ Add Track · ✂ Split · ⧉ Duplicate · 🗑 Delete  ·  ─── Zoom ───  · Fit"]
      TL2["Timeline 186px  —  Ruler  ·  Video track  ·  Audio track  ·  Text track  ·  Playhead"]
      TC --> TL2
    end

    Header --> Body
    Body --> Bottom
  end
```

```tsx
// In RAIL_ITEMS (ProductionEditor.tsx)
{ id: 'json', label: 'JSON', Icon: Braces }  // import Braces from 'lucide-react'
```

In the panel area (currently the 240px-wide sidebar), when `activePanel === 'json'`, render the live JSON viewer:

```tsx
{activePanel === 'json' ? (
  <LiveJsonPanel />
) : activePanel === 'text' ? (
  <ElementsPanel style={{ flex: 1, minHeight: 0 }} />
) : (
  <MediaPanel style={{ flex: 1, minHeight: 0 }} />
)}
```

### `LiveJsonPanel` implementation

```tsx
function LiveJsonPanel() {
  const engine = useTimelineEngine()
  const tracks = useTracksStore((s) => s.tracks)     // re-renders on any track/clip change
  const currentFrame = usePlaybackStore((s) => s.currentFrame)

  const scene = resolveTimeline(currentFrame, engine.getProject())

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px' }}>
      <pre style={{ fontSize: 10, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {JSON.stringify(scene, null, 2)}
      </pre>
    </div>
  )
}
```

**Key difference from Task 2:** Update triggers on `useTracksStore` changes (every edit), not only on playback. This makes the JSON reflect the current state as the user drags clips, changes properties, etc.

---

## Relevant Files

| File | Purpose |
|---|---|
| `apps/web/components/playground/timeline/TimelineEditor.tsx` | Timeline-only playground (Tasks 1 & 2) |
| `apps/web/components/playground/production/ProductionEditor.tsx` | Full production editor (Task 3) |
| `packages/timeline/src/classNames.ts` | `TimelineClassNames` interface — all slot names and docs |
| `packages/timeline/src/Timeline.tsx` | `TimelineProps` — `classNames`, `fps`, `className`, `style` |
| `packages/editor/src/editor/EditorProvider.tsx` | `EditorProviderProps` — `fps`, `stage`, `defaultTrackHeight`, `maxHistorySize`, `initialTracks` |
| `packages/core/src/resolver/resolveTimeline.ts` | `resolveTimeline(frame, project): Scene` |
| `packages/core/src/resolver/scene.ts` | `Scene` type + active clip shapes |

---

## Quick Reference — Imports

```ts
// resolveTimeline + Scene type
import { resolveTimeline } from '@elah/core'
import type { Scene } from '@elah/core'

// Stores
import { useTracksStore, usePlaybackStore } from '@elah/editor'

// Timeline classNames type
import type { TimelineClassNames } from '@elah/timeline'
```
