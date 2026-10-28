# React Native binding — start here

> **Status: timeline first, base built and runnable (2026-10-08).** `@elah/core/engine`,
> `EditorProvider` in `@elah/react`, the timeline model in `packages/react-native`, and the Expo
> harness in [`apps/mobile`](../../apps/mobile/README.md) (Hermes bundles verified; first
> on-device run owed). Contributor issues for the timeline UI: [`issues/`](./issues/README.md)
> (RN-T4 to RN-T9).
> **Last verified: 2026-10-06** against `dev` @ `e9fe11c`, when the packages were 0.6.0 and
> `@elah/cli` 0.1.2 (the four lockstep packages and the CLI are 1.0.0 as of 2026-10-28; this
> folder has not been re-audited against 1.0.0),
> the installed `node_modules`, and the npm registry / vendor docs cited inline.
> Every claim in this folder was checked against the source on that date. If you find one
> that is no longer true, fix the doc in the same PR that changed the code.

This folder is the hand-off for building **`@elah/react-native`**: an iOS/Android binding of
the Elah video engine with the same `Project` document, the same `TimelineEngine`, the same
pure `resolveTimeline`, and a Skia renderer in place of WebGL2. It is written so that a
contributor who has never opened this repository can pick a workstream, build it, and know
when it is done.

The older material in `docs/` (the June 2026 development plan, the timeline redesign, the
dev-branch review) predates the 0.6.0 port and the 1.0.0 release, and says nothing about mobile. Treat **this folder**
as the only current source for the React Native work.

---

## Reading order

| # | Doc | Read it when |
|---|-----|--------------|
| 1 | [`01-goals-and-scope.md`](./01-goals-and-scope.md) | You want to know what we are building, what we are deliberately not building, and what "done" means for v0.1. |
| 2 | [`02-platform-audit.md`](./02-platform-audit.md) | You want the evidence: which parts of `@elah/core` run on Hermes today, which are browser-bound, and the one blocker that stops the barrel loading under Metro. |
| 3 | [`03-architecture.md`](./03-architecture.md) | You are about to write code. Package layout, the seams every native piece plugs into, the data flow, and the invariants you must keep. |
| 4 | [`04-workstreams.md`](./04-workstreams.md) | You want a ticket. Twelve ordered, independently reviewable workstreams with allowed files and acceptance checks. |
| 5 | [`05-decisions.md`](./05-decisions.md) | You are about to choose a library, a thread model or a package boundary. The decided items, the open ones, and the reasoning. |
| 6 | [`06-contributing.md`](./06-contributing.md) | You are opening a PR. Tooling, Metro traps, what counts as verified, and the review bar. |

Before any of this, read the repo-wide [`ARCHITECTURE.md`](../../ARCHITECTURE.md) (sections 1 to 6
at least) and [`AGENTS.md`](../../AGENTS.md). The three invariants there (integer frames, one
mutation funnel, pure resolver) are not negotiable on mobile either.

---

## The thesis in six lines

1. **The engine already runs without a browser.** `TimelineEngine`, `resolveTimeline`,
   `PlaybackEngine`, the stores, clip factories, serialisation and the placement math evaluate
   and work in plain Node with no DOM (measured; see the audit). React Native supplies the
   three globals the clock needs (`requestAnimationFrame`, `cancelAnimationFrame`,
   `performance.now`).
2. **`@elah/react` is reusable as-is.** Its 13 source files contain no DOM reference. The
   store hooks and editor context are the same on mobile.
3. **Exactly one thing stops `@elah/core` loading under Metro today:** `import.meta.url` in
   `packages/core/src/export/exportVideo.ts`. Metro and Hermes reject `import.meta`. The fix is a
   browser-free `@elah/core/engine` entry point, which is workstream RN-P1.
4. **Rendering, decode, audio, import and export are rebuilt on native seams**, not ported.
   The renderer is Skia (`react-native-skia` v3). Decode and encode are a native module over
   AVFoundation / MediaCodec. Audio playback can run through `react-native-audio-api`, which
   implements the Web Audio nodes `AudioPlaybackController` uses (but not `OfflineAudioContext`,
   so export audio is mixed natively).
5. **Parity is by construction, not by testing alone.** Mobile preview and export consume the
   same `Scene` and the same `resolveDrawRect` / `computeTextLayout` helpers as the web, so a
   text-and-image project renders with identical geometry on both.
6. **FFmpeg is not in the plan.** `ffmpeg-kit-react-native` was retired in January 2025 and
   its binaries were removed; the author's replacement is source-only. Platform codecs are the
   path.

---

## How to pick up work

1. Read the six docs in order. It takes about forty minutes.
2. The current track is **timeline first**: take an unclaimed issue from
   [`issues/`](./issues/README.md) (RN-T1 to RN-T9) whose dependencies are merged. Outside that
   track, pick the lowest-numbered workstream in [`04-workstreams.md`](./04-workstreams.md) whose
   dependencies are met and that nobody has claimed (open an issue titled `RN-Pn: <goal>` to
   claim it).
3. Stay inside the workstream's **allowed files**. If you need to touch something else, that is a
   separate workstream or a separate PR.
4. Run the workstream's **acceptance** commands and paste real output into the PR. On-device
   checks are manual: attach the screenshot or screen recording the ticket asks for.
5. Update the docs the workstream names. Then flip that workstream's status line in
   `04-workstreams.md` from `proposed` to `done (PR #…)`.

Conventions for branches, commits and PR hygiene are the repo's own:
[`CONTRIBUTING.md`](../../CONTRIBUTING.md). Mobile-specific additions are in
[`06-contributing.md`](./06-contributing.md).

---

## What is explicitly out of scope for this folder

- Changing the engine's data model, time model or resolver semantics. If mobile needs a
  change there, it is a core proposal first (an issue, then a `ROADMAP.md` decisions-log entry).
- A web-view wrapper around the existing editor. The point of the binding is native rendering
  and native codecs.
- Desktop targets (macOS via Skia is possible later; not in v0.1).
- The elah.dev docs site content for mobile. That is the last workstream (RN-P11) and lands
  only when a package is on npm.
