# Roadmap

> The sequenced plan that turns the engine foundation into a working browser-native portrait/reels editor.

The path is **six foundation PRs** before any feature work begins. Each PR is self-contained — see [`docs/backlog/`](./docs/backlog/) for a per-PR ticket with scope, acceptance criteria, and an implementation prompt you can hand to a coding agent.

---

## Why a sequenced foundation

Two prior attempts at a similar editor (`Oxide-Editor`, `render-kit`) collapsed at the same point: when gallery, drag-drop, media, timeline, and preview all started needing each other's state. The fix isn't to write the renderer more carefully — it's to put the boundaries in place **before** anything else gets built on top.

This roadmap front-loads boundary work into six small PRs (PR-01 … PR-06) so that everything after them is fill-in-the-blank.

---

## Foundation (PR-01 → PR-06)

Status snapshot — update as PRs land.

| PR | Title | Status | Risk | Estimated effort |
|---|---|---|---|---|
| 01 | [Engine invariants: `moveClip` + `trimClip`](./docs/backlog/PR-01-engine-invariants.md) | 🔴 Not started | Low | 1–2 hours |
| 02 | [`resolveTimeline` tests](./docs/backlog/PR-02-resolver-tests.md) | 🔴 Not started | Low | 1–2 hours |
| 03 | [Schema: `Project.stage` + `Clip.transform?`](./docs/backlog/PR-03-schema-stage-transform.md) | 🔴 Not started | Medium | 2–3 hours |
| 04 | [`MediaLibrary` skeleton + asset model](./docs/backlog/PR-04-media-library-skeleton.md) | 🔴 Not started | Medium | 2–3 hours |
| 05 | [`EditorProvider` and engine lift](./docs/backlog/PR-05-editor-provider.md) | 🔴 Not started | Medium-High | 3–4 hours |
| 06 | [Render contract + drag plumbing seams](./docs/backlog/PR-06-render-contract.md) | 🔴 Not started | Low | 1–2 hours |

**Total foundation effort:** roughly 10–16 focused hours, spread across 6 separately-reviewable commits.

---

## Sequencing rules

These rules are how the foundation gets built without re-debt.

1. **One PR at a time, merged before the next starts.** Each PR is a rollback point.
2. **Each PR ends with `tsc --noEmit` clean and a manual smoke test in the playground.**
3. **No scope expansion mid-PR.** Spot something else? Open a follow-up ticket. The temptation to "while I'm in here" is what turns a 100-line PR into a 600-line PR.
4. **Commit message format:** `<area>: <verb> <object>` — e.g. `engine: enforce overlap on moveClip`.
5. **If a PR's acceptance criteria can't be met, stop and write a new ticket.** Don't ship half a feature.

---

## After the foundation (PR-07 → PR-12+)

Once PR-06 is merged, feature work begins. These PRs are **not** specified in detail yet — they should be planned freshly once the foundation is in hand, with concrete user-visible goals.

See [`docs/backlog/PR-07-onwards.md`](./docs/backlog/PR-07-onwards.md) for the working sketch.

| PR | Theme | What it unlocks |
|---|---|---|
| 07 | `MediaLibrary.importFiles` | Real assets can enter the editor |
| 08 | `<MediaGallery />` UI | Visual asset library |
| 09 | `useTimelineDrop` implementation | Drag-drop creates clips |
| 10 | `<Preview />` + `DomRenderer` | **Video actually plays.** |
| 11 | Wire `<Preview />` into playground | First real demo |
| 12+ | Text overlays, transform gizmos, transitions, effects, export | Feature breadth |

PR-10 is the milestone moment — the first time your timeline plays a real video file.

---

## What is explicitly *not* on this roadmap

These are deliberately out of scope until far later. Pre-emptive flags so they don't accidentally creep in:

- WebGPU / WebGL renderers — wait until DOM is shipped and the bottleneck is measured.
- AudioContext clock anchoring — wait until audio is in the playback path.
- Resolver memoization — wait until profiling shows it matters.
- Worker-based thumbnails — main-thread is fine until it isn't.
- A second package — keep everything in `@myeditor/timeline` until file count or build time forces a split.
- A state library beyond Zustand — current setup is correct.
- Plugin system, event bus, dependency injection — add when needed, not before.

See [`ARCHITECTURE.md` § 9](./ARCHITECTURE.md#9-what-this-architecture-rejects-anti-patterns) for the full anti-pattern list.

---

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05 | Single package (`@myeditor/timeline`) until proven otherwise | Avoid premature monorepo split |
| 2026-05 | Frames as the only time unit | Eliminate floating-point drift |
| 2026-05 | `resolveTimeline` is pure | Renderer-agnostic; worker-safe; testable |
| 2026-05 | Zustand stores are Ring 1 mirrors only | Engine remains source of truth |
| 2026-05 | Native HTML5 DnD (no `react-dnd`/`dnd-kit`) | Matches Freecut; one less dependency |
| 2026-05 | DOM renderer first, GPU later | Ship value before complexity |

Add new decisions here as they're made.
