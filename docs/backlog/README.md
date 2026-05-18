# Backlog

> Self-contained tickets for the **foundation phase** (PR-01 → PR-06) plus the post-foundation roadmap (PR-07+).

Each ticket is designed to be picked up cold — by you, by a teammate, or by an implementation agent — and shipped in one focused session. Read the ticket top to bottom; the **copy-paste prompt** at the bottom is what you hand to an AI coding agent.

---

## Architecture direction

The repo is a **single package, `@elah/editor`**, internally layered into three runtime tiers:

```
packages/editor/src/
  core/      ← runtime: types, engine, playback, resolver, stores, actions, media, utils
  timeline/  ← timeline UI surface (Timeline, ClipBlock, TrackRow, hooks, drop)
  editor/    ← composition: EditorProvider, EditorSDK, AssetPanel, Preview, renderer
```

**Dependency rule:** `core → timeline → editor`. One-way only.

- `core/` is the authoritative editor runtime; React-agnostic where possible. Runtime state (tracks / playback / selection) is owned here.
- `timeline/` consumes runtime contracts from `core/`; it does **not** own playback or the resolver.
- `editor/` composes the integrated editing experience.
- Zustand is an implementation detail. The recommended public surface is named hooks/APIs (`useAssets()`, `usePlayback()`, `useTracks()`, `useSelection()`), not raw `store.setState(...)`.

Multi-package extraction (`@elah/core`, `@elah/timeline`, etc.) is deferred until there's real pressure — a non-React consumer, bundle separation needs, or independent adoption. The internal layering means that extraction, when it comes, is mechanical. See [PR-07-onwards.md § Phase 5](./PR-07-onwards.md#phase-5--package-extraction-when-forced--not-now).

---

## Foundation phase (sequential — do not parallelize)

| # | Title | Status | Why this PR matters |
|---|---|---|---|
| [PR-01](./PR-01-engine-invariants.md) | Engine invariants: `moveClip` + `trimClip` | 🟢 Merged | Drag/drop will exercise both functions immediately; bugs become reproducible-by-user-gesture |
| [PR-02](./PR-02-resolver-tests.md) | `resolveTimeline` tests | 🟢 Merged | The resolver runs 60×/sec under the renderer; bugs are invisible without tests |
| [PR-03](./PR-03-schema-stage-transform.md) | Schema: `Project.stage` + `Clip.transform?` | 🟢 Merged | Schema changes are cheapest before consumers exist |
| [PR-04](./PR-04-media-library-skeleton.md) | Package rename + 3-layer restructure + `MediaLibrary` skeleton | 🔴 Not started | Establish the layered architecture and the asset model in one atomic move |
| [PR-05](./PR-05-editor-provider.md) | `EditorProvider` and engine lift (lands in `editor/`) | 🔴 Not started | AssetPanel + Preview need to live as Timeline siblings, not its children |
| [PR-06](./PR-06-render-contract.md) | Render contract + drag plumbing seams (split across all three layers) | 🔴 Not started | The final "empty seats" the next agent fills in |

**Do not skip PRs.** Each protects the next from a class of bugs.

---

## Post-foundation

[PR-07-onwards.md](./PR-07-onwards.md) — sketched, not fully specified. After PR-06 lands, plan PR-07 in detail with fresh eyes.

---

## How to use a ticket

1. **Read the whole ticket.** Each one has Goal, Why, Scope, Acceptance Criteria, Out-of-Scope, Implementation Notes, Verification, and Copy-paste prompt.
2. **Verify scope.** If you find yourself wanting to change files outside the documented scope, **stop**. Open a follow-up ticket instead.
3. **Hand the copy-paste prompt to an agent**, or implement manually, your choice.
4. **Walk the acceptance criteria one by one** before opening the PR. They're the review checklist.
5. **Update the status** in this index and in [`ROADMAP.md`](../../ROADMAP.md) when the PR is merged.

---

## Status legend

- 🔴 **Not started**
- 🟡 **In progress** (someone has a branch open)
- 🟢 **Merged**
- ⚫ **Cancelled / superseded** (link to replacement)
