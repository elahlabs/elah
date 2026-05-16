# Reelforge

> **A browser-native, frame-accurate video editor for any aspect ratio (9:16 reels, 16:9 YouTube, 1:1, and beyond) — engine-first, renderer-agnostic, scalable from MVP to production.**

> Working name. See [Repo name candidates](#repo-name-candidates) below — pick one before the first public push.

---

## What this is

Reelforge is an open architecture for building a **browser-native video editor** on top of React. It is aspect-ratio agnostic by design — the same engine drives **9:16 vertical content** (Reels / Shorts / TikTok), **16:9 landscape content** (YouTube, long-form), **1:1 square**, or any custom stage size. It is **not** a UI framework or a clone of a specific product; it is the **engine, resolver, and timeline SDK** that any modern web-based video editor should sit on.

Three goals shape every decision:

1. **Deterministic playback.** Same project + same frame = same pixels, always.
2. **Renderer-agnostic core.** The data model and timeline resolver know nothing about DOM, Canvas, WebGL, or WebGPU. Swap rendering backends without touching state.
3. **Iteration speed.** Small surface area, no plugin systems, no over-engineered abstractions. You can read the entire core in one sitting.

---

## Status

| Layer | Status |
|---|---|
| Timeline data model (`Clip`, `Track`, `Project`) | ✅ Stable, frame-based |
| `TimelineEngine` (Immer + history + events + batch) | ✅ Stable |
| `PlaybackEngine` (RAF clock + subscribe) | ✅ Stable |
| `resolveTimeline(frame, project) → Scene` (pure resolver) | ✅ Stable, solo/mute/zIndex correct |
| Timeline UI (`Timeline`, `Ruler`, `TrackRow`, `ClipBlock`, `Playhead`) | ✅ Working |
| Media gallery + drag-drop | 🟡 Designed, not built (see [ROADMAP](./ROADMAP.md)) |
| Preview renderer (DOM) | 🟡 Designed, not built |
| Text overlays + transforms | 🟡 Schema ready, no UI |
| Export pipeline | ⚪ Not started |
| Effects / transitions / animations | ⚪ Not started |

See [`ROADMAP.md`](./ROADMAP.md) for the sequenced PR plan.

---

## Architecture (one paragraph)

A single immutable `Project` tree owns all timeline data. The framework-agnostic `TimelineEngine` is the only place mutations happen — every edit is an Immer-backed commit with structural sharing, history, batching, and typed events. Time is **integer frames**; never floating-point seconds. A standalone `PlaybackEngine` owns the RAF loop and emits `(frame, isPlaying)` snapshots; React is a downstream consumer via Zustand mirrors. A pure function `resolveTimeline(frame, project) → Scene` determines what is visible and audible at any given frame — this is the only thing renderers consume. Any renderer (DOM, Canvas, WebGL, WebGPU, or a WASM exporter) implements the same `Renderer` interface and reads only the `Scene`.

For the full architecture document, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Repository layout

```
MyEditorPackage/
├── README.md                     # this file
├── ARCHITECTURE.md               # the engine architecture in depth
├── ROADMAP.md                    # sequenced PR plan
├── CONTRIBUTING.md               # how to add a PR
├── apps/
│   └── playground/               # Vite + React demo app
└── packages/
    └── timeline/                 # @myeditor/timeline SDK
        └── src/
            ├── core/
            │   ├── editor/       # TimelineEngine
            │   ├── playback/     # PlaybackEngine
            │   ├── resolver/     # resolveTimeline + Scene
            │   ├── elements/     # clip factories
            │   ├── track/        # track factories
            │   └── visitor/      # add / remove / update / split / clone
            ├── stores/           # Zustand mirrors (tracks / playback / selection)
            ├── ui/               # Timeline, Ruler, TrackRow, ClipBlock, Playhead
            ├── utils/            # frames math, snap, id
            ├── actions/          # composed ops (e.g. splitClipAtPlayhead)
            └── types/            # Clip, Track, Project, EngineEvent
docs/
├── glossary.md                   # terminology
├── references.md                 # study guide for related repos
└── backlog/
    ├── README.md                 # PR index
    ├── PR-01-engine-invariants.md
    ├── PR-02-resolver-tests.md
    ├── PR-03-schema-stage-transform.md
    ├── PR-04-media-library-skeleton.md
    ├── PR-05-editor-provider.md
    ├── PR-06-render-contract.md
    └── PR-07-onwards.md
```

---

## Quick start

```bash
git clone <repo-url>
cd video-editor
npm install
npm run dev      # starts apps/playground at http://localhost:5173
npm run typecheck
```

Then in the playground, add a video track, add a clip, hit **Space** to play. Keyboard shortcuts:

| Key | Action |
|---|---|
| **Space** | Play / pause |
| **S** | Split selected clip at playhead |
| **Ctrl/Cmd + Z** | Undo |
| **Ctrl/Cmd + Shift + Z** / **Ctrl/Cmd + Y** | Redo |
| **Ctrl/Cmd + scroll** | Zoom timeline |

---

## How to use the SDK in your own app

```tsx
import { Timeline, useTracksStore, usePlaybackStore, type TimelineRef } from '@myeditor/timeline'
import { useRef } from 'react'

function App() {
  const ref = useRef<TimelineRef>(null)

  const addClip = () => {
    const engine = ref.current?.engine
    if (!engine) return
    const track = engine.addTrack('video')
    engine.addClip({
      trackId: track.id,
      type: 'video',
      name: 'My clip',
      startFrame: 0,
      durationFrames: 90,
    })
  }

  return (
    <>
      <button onClick={addClip}>Add clip</button>
      <Timeline ref={ref} fps={30} style={{ height: 400 }} />
    </>
  )
}
```

To consume the resolver directly (for a preview component or export pipeline):

```ts
import { resolveTimeline } from '@myeditor/timeline'

const scene = resolveTimeline(currentFrame, engine.getProject())
// scene.videos, scene.audios, scene.texts, scene.images, scene.transitions
```

---

## Design philosophy

- **Engine-first.** The core is plain TypeScript. React is a consumer, not a master.
- **Frames, not seconds.** Integer time eliminates a class of floating-point bugs that haunt every NLE.
- **One mutation funnel.** All edits go through `TimelineEngine.commit()`. No back-doors.
- **Pure resolver.** `resolveTimeline` is deterministic and side-effect-free, so it can run in tests, workers, and export pipelines without ceremony.
- **Renderer is just a consumer.** A renderer reads `Scene`, writes pixels, and knows nothing else.
- **Small surface area.** No plugin systems, no event buses, no dependency injection. Until proven needed.

For the longer treatment, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Contributing

The current development model is **sequenced foundation PRs** (1–6 in [`ROADMAP.md`](./ROADMAP.md)) before feature work begins. Each PR in [`docs/backlog/`](./docs/backlog/) is **self-contained** — scope, acceptance criteria, and an implementation-agent prompt — so PRs can be handed off cleanly.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for branch/commit conventions.

---



---

## License

To be decided. MIT or Apache-2.0 recommended for maximum reuse.
