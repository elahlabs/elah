# AGENTS.md

Canonical brief for AI coding agents (Claude Code, Cursor, Codex, etc.) working in
this repo. Human contributors: read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and
[`ARCHITECTURE.md`](./ARCHITECTURE.md) — this file distills the same rules into an
agent-oriented checklist. Everything here is verified against the committed source;
where a general doc (README §layout, `ARCHITECTURE.md` §8, `docs/glossary.md` links)
still describes the older single-package layout, **this file wins.**

## What this is

Elah — a browser-native, frame-accurate video editing engine. A framework-agnostic
core (timeline engine, pure resolver, WebGL2 renderer, WebCodecs decode, MP4 export)
with React bindings on top. npm workspaces monorepo.

## Commands

Run from the repo root after `npm install`:

```bash
npm run dev              # Next.js website + embedded editor (apps/web) at http://localhost:3001
npm run typecheck        # tsc --noEmit at root
npm test                 # vitest suites in packages/core AND packages/timeline
npm run build:packages   # builds core → timeline → editor (order matters)
npm run build            # builds apps/web (prebuild runs build:packages)
npm run lint:tokens      # guards against raw hex colors drifting from --elah-* tokens
npm run lint --workspace=apps/web   # next lint for the website
```

Run a single test file (vitest, node environment):

```bash
npm run test --workspace=packages/core -- src/resolver/resolveTimeline.test.ts
npm run test:watch --workspace=packages/core   # watch mode
```

`playground/next` and `playground/react` are intentionally **outside** the workspace
— they consume the published npm packages, not local source. `cd` in and
`npm install` separately to use them.

## Repo map (the real layout)

Four workspaces: three published packages plus the website.

- `packages/core` (`@elah/core`) — framework-agnostic engine, **zero React imports**.
  Subsystems under `src/`: `types/`, `editor/` (TimelineEngine), `playback/`
  (PlaybackEngine), `resolver/` (`resolveTimeline`), `stores/` (Zustand mirrors),
  `assets/` + `media/` (WebCodecs decode, mediabunny demux, audio), `renderer/`
  (Renderer interface + WebGL2 `GpuRenderer` in `gpu/`, layers in `gpu/layers/`),
  `export/` (worker → OffscreenCanvas → MP4), `visitor/`, `track/`, `elements/`,
  `actions/`, `debug/`.
- `packages/timeline` (`@elah/timeline`) — React timeline UI: `Timeline`, `TrackRow`,
  `ClipBlock`, `Ruler`, `Playhead`, drag/trim hooks.
- `packages/editor` (`@elah/editor`) — full SDK: `EditorProvider`, `Preview`,
  `AssetPanel`, `ElementsPanel`, `useResolvedScene`; re-exports core + timeline.
- `apps/web` — Next.js site (elah.dev): docs, blog, playground pages. Playground UI
  components live in `apps/web/components/playground/`.

**Dependency rule: core ← timeline ← editor.** Lower layers never import higher ones.

## Load-bearing rules (do not violate)

`ARCHITECTURE.md` is canonical; read it before changing anything in core. The rules
an agent breaks most often:

- **Time is integer frames.** `startFrame`, `durationFrames`, `currentFrame`. Seconds
  exist only at the media boundary (`videoEl.currentTime = sourceFrame / fps`).
- **One mutation funnel.** Every project change goes through `TimelineEngine.commit()`
  (Immer drafts + history + events). No side-channel writes.
- **Three-ring state.** Ring 0: engine classes (`TimelineEngine`, `PlaybackEngine`,
  MediaLibrary) own the truth. Ring 1: Zustand mirrors (`useTracksStore`,
  `usePlaybackStore`, `useMediaLibraryStore`) sync from engine events. Ring 2: UI-only
  state (`useSelectionStore`, drag state). Outer rings read inner; never the reverse.
  Engine state never lives in `useState`/`useRef`.
- **Pure resolver.** `resolveTimeline(frame, project) → Scene` has no side effects, no
  DOM, no React. Renderers, the export worker, and `AudioPlaybackController` all
  consume the `Scene` — none of them ever import `Project` or `Clip`.
- **Renderers are dumb.** `render(scene)` is synchronous and idempotent on equal scene
  references, and reads only the `Scene`. Async decode is out-of-band.
- **No plugin systems, no event buses, no micro-packages.** `ARCHITECTURE.md` §9 is an
  explicit anti-pattern no-go list; PRs adding such abstractions get rejected.

Data-model invariants enforced by `TimelineEngine`: `clips[trackId]` always sorted by
`startFrame`, never overlapping within a track; `durationFrames >= 1`; for media clips
`sourceStartFrame + durationFrames <= sourceDurationFrames`.

Current v1 constraint: single video track + single audio track (renderer/decode
pipeline not yet multi-track).

## Before you touch a subsystem

The renderer subtree has an explicit agent contract in
[`packages/core/src/renderer/AI-Rules.md`](./packages/core/src/renderer/AI-Rules.md).
Generalize its spirit to the other engine subsystems: **read the subsystem's docs
first, then add tests that cover lifecycle, disposal, and invariant enforcement.**

| If you change…       | Read first                                                                  | Test target                              |
| -------------------- | --------------------------------------------------------------------------- | ---------------------------------------- |
| `renderer/`          | `renderer/architecture.md`, `renderer/EVOLUTION.md`, `renderer/AI-Rules.md` | `renderer/gpu/__tests__/`                |
| `export/`            | `export/Architecture.md`                                                    | export worker + `resolveTimeline` parity |
| `playback/`          | `playback/README.md`                                                        | `playback/PlaybackEngine.test.ts`        |
| `media/` + `assets/` | `media/README.md`, `media/audio/README.md`, `media/video/README.md`         | `media/audio/__tests__/`                 |
| `resolver/`          | `ARCHITECTURE.md` (resolver section)                                        | `resolver/resolveTimeline.test.ts`       |

New renderer subsystems require doc updates (README/architecture/evolution) **and**
vitest coverage — see `AI-Rules.md`.

## Common tasks (where to touch)

- **Add a clip type** — extend the `ClipType` union in
  `packages/core/src/types/index.ts` (currently `'video' | 'audio' | 'text' | 'image'`),
  then handle it in `resolver/resolveTimeline.ts` (emit into the right `Scene` bucket)
  and add a renderer layer (below). Update resolver tests.
- **Add a renderer layer** — add `FooLayer.ts` under
  `packages/core/src/renderer/gpu/layers/`, register it in the render graph
  (`gpu/RenderGraph.ts` / `gpu/GpuRenderer.ts`), and add a `gpu/__tests__/` spec.
  Follow `renderer/AI-Rules.md`.
- **Add a transition kind** — extend `TransitionKind` in
  `packages/core/src/types/index.ts` (currently `'fade' | 'slide' | 'wipe'`), implement
  it in `resolver/resolveTimeline.ts`, and mirror it in the export worker so preview and
  export never drift.
- **Add a playground UI control** — edit components in
  `apps/web/components/playground/`. These are website-only; they do not ship in the npm
  packages.

## Conventions

- **Commits:** single line, `<area>: <verb> <object>` — areas: `engine`, `playback`,
  `resolver`, `renderer`, `media`, `export`, `assets`, `ui`, `types`, `tests`, `docs`,
  `build`, `chore`. Branches: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`,
  `docs/<slug>`.
- **Style:** TypeScript strict; 2-space indent, single quotes, no semicolons;
  `interface` for extensible object shapes, `type` for unions/aliases; JSDoc the _why_,
  never the _what_.
- New dependencies need clear justification ([`BUNDLE_STRATEGY.md`](./BUNDLE_STRATEGY.md));
  the dependency surface is intentionally small.
- Changing a design principle (P1–P6 in `ARCHITECTURE.md`) requires an issue/discussion
  first, not a PR.
- Update [`docs/known-bugs.md`](./docs/known-bugs.md) when adding a deliberate
  workaround; [`CURRENT_LIMITATIONS.md`](./CURRENT_LIMITATIONS.md) when shipping or
  closing a known gap.

## State the blast radius

Before implementing a change, state what it touches: every file/area, what's affected
downstream (consumers, exports, build, other packages), and what is explicitly NOT
touched. Keep it concrete (paths, counts). Surface this up front, not after.

## Doc index

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — canonical engine architecture (P1–P6, §9
  anti-patterns)
- [`ROADMAP.md`](./ROADMAP.md) — current state + next layer
- [`CURRENT_LIMITATIONS.md`](./CURRENT_LIMITATIONS.md) — known gaps
- [`docs/known-bugs.md`](./docs/known-bugs.md) — deliberate workarounds + real fixes
- [`docs/glossary.md`](./docs/glossary.md) — terminology
- [`BUNDLE_STRATEGY.md`](./BUNDLE_STRATEGY.md) — dependency budget + measured sizes
- [`PERFORMANCE.md`](./PERFORMANCE.md) — performance philosophy + techniques
- [`packages/core/src/renderer/architecture.md`](./packages/core/src/renderer/architecture.md) — GPU render + decode pipeline
- [`packages/core/src/renderer/AI-Rules.md`](./packages/core/src/renderer/AI-Rules.md) — renderer agent guardrails
- [`packages/core/src/export/Architecture.md`](./packages/core/src/export/Architecture.md) — export pipeline in depth
- [`packages/core/src/playback/README.md`](./packages/core/src/playback/README.md) — playback engine
- [`packages/timeline/THEMING.md`](./packages/timeline/THEMING.md) — timeline styling paths
- [`docs/design-tokens.md`](./docs/design-tokens.md) — `--elah-*` token system
