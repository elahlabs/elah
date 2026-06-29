# Dev Branch — Architecture Review

> Generated 2026-06-28 against `git diff main...HEAD` (26 commits, 63 files changed).
> Each item is a checkbox so it can be worked through before merge.

---

## How to read this

- **Blocking** — must be resolved before merge; either breaks a published API, fails CI, or directly contradicts a load-bearing architecture principle.
- **Should fix** — the documented acceptance criteria for this wave are not met; the feature works but the PR is incomplete against its own spec.
- **Discuss** — the dev branch took a different approach than the written plan; the approach may be better, but it should be a deliberate, recorded decision rather than a silent divergence.
- **Pre-existing / not blocking** — documented before this branch; flagged for awareness, not for this PR to fix.

---

## 1  Blocking — CI and Published API

### 1.1  `scripts/check-tokens.mjs` fails on the dev branch
- [ ] **Status:** `node scripts/check-tokens.mjs` exits non-zero with 2 violations.
- **Where:** `packages/timeline/src/ClipBlock.tsx` lines 32–33.
- **What:** The lint guard regex `/#[0-9a-fA-F]{3,8}\b/` matches hex values inside *inline comments* (`// exact body #0c2a26`, `// exact body #7a2e10`). The hex is not used in any style; it is documentation explaining what the Tailwind class resolves to. The guard does not exclude comment lines.
- **Fix options (pick one):**
  - Strip JS comment content before the hex regex check in `check-tokens.mjs`.
  - Remove the hex from the comments in `ClipBlock.tsx` (the Tailwind class name is self-documenting enough).
- **Why blocking:** Any CI step that runs `lint:tokens` will block the merge.

---

### 1.2  `timelineTheme` / `TimelineTheme` public API removed without a deprecation path

- [ ] **Status:** `packages/timeline/src/theme.ts` was deleted. `@elah/timeline`'s `index.ts` no longer exports `timelineTheme` or `TimelineTheme`.
- **Where:** `packages/timeline/src/index.ts` (confirmed — `timelineTheme` is absent from exports).
- **What the documented plan requires:**

  From `docs/development-plan/01-unified-design-system.md`:
  > "Key move: **keep the `timelineTheme` API, re-point its values at the CSS vars.**  
  > 86 references across 8 timeline components use `timelineTheme.<group>.<token>` — do not churn them."
  > "**Don't break the published `timelineTheme` / `TimelineTheme` exports — third parties may import them.**"

- **What the dev branch does instead:** Deletes `theme.ts` entirely. Components now consume Tailwind token classes (`bg-clip-video-mid`, `text-ed-accent`, etc.) directly — which is architecturally sound — but the migration was done by rewriting all call sites rather than re-pointing `timelineTheme` values at `var()` strings as the plan prescribed.
- **Impact:** Any consumer who imports `timelineTheme` or `TimelineTheme` from `@elah/timeline` — including external adopters who followed the `packages/timeline/README.md` documentation — will get a TypeScript/module error on upgrade. This is a breaking API change with no deprecation.
- **Decision needed:** Either (a) re-export `timelineTheme` as a backward-compat facade that maps to the CSS var strings, or (b) record this as an intentional breaking change in a changelog / BREAKING.md and bump the major version. Silently removing it is not acceptable.

---

## 2  Should Fix — Acceptance Criteria Gaps

The `docs/development-plan/01-unified-design-system.md` defines an explicit acceptance checklist for the design-system workstream. The following items are **not yet satisfied** on the dev branch.

### 2.1  Acceptance criterion: "StageBorder uses the token accent (no third crimson)"

- [ ] **Status:** NOT MET.
- **Where:** `packages/editor/src/editor/Preview/StageBorder.tsx` lines 51–52.
- **What:** The stage frame border and glow still fall back to the original crimson:
  ```ts
  border: '1px solid var(--elah-stage-border, rgba(225, 29, 72, 0.45))',
  boxShadow: 'var(--elah-stage-glow, 0 0 20px rgba(225, 29, 72, 0.08))',
  ```
  The `--elah-stage-border` and `--elah-stage-glow` tokens are referenced correctly, but their *fallback values* are the old crimson — and the cyan redesign on dev has changed the accent to `#00c2ff`. If the tokens are not set in the host environment, the StageBorder renders crimson while every other accent surface renders cyan.
- **Fix:** Update the fallback values to a cyan/neutral that matches `--elah-accent`, or ensure `--elah-stage-border` and `--elah-stage-glow` are always defined in `tokens.css` and `globals.css` before this component is used.

---

### 2.2  Acceptance criterion: "One 'selected' color across Preview overlays, asset cards, and the timeline"

- [ ] **Status:** NOT MET.
- **Where:** `packages/editor/src/editor/Preview/TextOverlay.tsx` lines 296, 327–328, 379 and `packages/editor/src/editor/Preview/MediaTransformOverlay.tsx` lines 292, 320–321.
- **What:** Both overlays use `var(--elah-selection-color, #4c9aff)` and `var(--elah-selection-handle, #fff)` — but `--elah-selection-color` is not defined in `tokens.css` or in the `.elah-root` block in `globals.css`. The fallback `#4c9aff` (blue) therefore always fires, making the selection handles blue while the timeline's own selected-clip highlight uses `--elah-selection-border`/`--elah-selection-glow` (cyan family). Selection chrome is still two different colors depending on whether the selection is in the canvas or the timeline ruler.
- **Fix:** Add `--elah-selection-color` and `--elah-selection-handle` to `tokens.css` (defaulting to values derived from `--elah-accent`), and add the same to `globals.css`'s `.elah-root` block. Document them in `docs/design-tokens.md` under the "Preview" group.

---

### 2.3  Acceptance criterion: "No new raw hex (`#rrggbb`) in a component"

> This criterion is stated in `docs/development-plan/README.md` under "Cross-cutting acceptance bar."

- [ ] **Status:** NOT MET in `apps/web/` playground components (out of scope for `check-tokens.mjs`, but violates the acceptance bar).
- **Where:**
  - `apps/web/components/playground/ProductionEditor.tsx` lines 110–112: demo button gradient `linear-gradient(#00a0d4, #0086b8)` and border `#0083b3`, text `#fff`.
  - `apps/web/components/playground/RawEditor.tsx` line ~681: play-button active color `#22C55E`.
  - `apps/web/components/playground/TimelineEditor.tsx`: same play-button pattern.
- **What:** The app-level playground files are excluded from `check-tokens.mjs` (which only scans `packages/`), so CI does not catch these. But the docs acceptance bar says "no new raw hex in a component" across the whole codebase.
- **Fix:**
  - The demo-button cyan values (`#00a0d4` / `#0086b8`) are intentionally darker than `--elah-accent` per a code comment, but they should be defined as `--elah-accent-deep` or derived via `color-mix(in srgb, var(--elah-accent), #000 20%)` rather than hardcoded.
  - The play-button green should be `--elah-color-success` or a shared success token; add it to `tokens.css`.

---

### 2.4  Ruler timecode format diverges from `framesToTimecode` everywhere else

- [ ] **Status:** CONFIRMED bug (also in prior code-review findings).
- **Where:** `packages/timeline/src/Ruler.tsx` — `formatRulerLabel` function.
- **What:** `formatRulerLabel` hardcodes the minutes segment as `"00"` and never rolls over seconds, producing `"00:90"` for a 90-second project while `framesToTimecode` (used in TransportBar, RawEditor toolbar, etc.) produces `"00:01:30:00"`. Two incompatible timecode formats appear simultaneously on screen. Above 99 seconds the label also overflows its rendered width (`"00:600"` at 10 minutes).
- **Architecture reference:** ARCHITECTURE.md § 3 "Time is integer frames" — the timecode display is not about integer frames, but the *format* used to display them should be consistent. The `framesToTimecode` helper in `@elah/core/utils/frames.ts` exists for this purpose; `formatRulerLabel` should call it.
- **Fix:** Replace the custom label formatter with `framesToTimecode(frame, fps)` from `@elah/core`, using the `MM:SS` slice of the output for short timelines (or the full `HH:MM:SS` for long ones).

---

## 3  Discuss — Approach Diverges from Written Plan

These are cases where the dev branch did something different from what the architecture or design-plan documents say. The new approach may well be correct — but the decision should be explicit.

### 3.1  Design system migration: deleted `theme.ts` vs "thin var() facade" plan

- [ ] **Discussion needed.**
- **Written plan (`01-unified-design-system.md`):** Keep `timelineTheme` as an object; re-point each value to `var(--elah-*)` strings so the 86 call sites in timeline components keep working unchanged. This preserves the public API and avoids a churn commit across all timeline component files.
- **Actual implementation on dev:** Replaced every `timelineTheme.*` call site in the timeline components with Tailwind token classes (`bg-clip-video-mid`, `text-ed-accent`, etc.). Then deleted `theme.ts` because no call sites remained.
- **Assessment:** The Tailwind-class approach is arguably more composable and more idiomatic (the `classNames` slot API works better with Tailwind classes than with `var()` strings). But it churn-rewrote every timeline component instead of a one-file change, and it removes a documented public export.
- **What needs documenting:** If the team confirms the Tailwind-class approach is the chosen path, update `01-unified-design-system.md` tasks 3 and 8 to reflect what actually happened, and record the API break in a changelog.

---

### 3.2  Multi-audio-track UI vs "single audio track" v1 constraint

- [ ] **Discussion needed.**
- **Written constraint (`docs/development-plan/README.md`):** "v1 is single video track + single audio track. The UI must not imply layering the engine can't place."
- **What the dev branch does (PR #15):** Introduces multi-track timeline UI with full track-management controls (add/delete/lock/mute per row). Video tracks are capped at one in `TimelineEngine.addTrack()`. Audio and text tracks are **uncapped** — the engine will accept any number.
- **Tension:** The `ROADMAP.md` and `README.md` both document "multi-track video/audio compositing beyond the current single-track v1 path" as a future item; the renderer and decode pipeline are not yet designed for multi-track compositing. Adding a second audio track in the UI will place both clips in the store, but the renderer (`AudioPlaybackController`) likely plays only the first audio track.
- **Risk:** If a user adds two audio tracks and places clips on both, only one track's audio plays during export. The UI implies full compositing that isn't backed by the engine.
- **Decision needed:** Either (a) cap audio tracks at 1 in `TimelineEngine.addTrack()` the same way video is capped, and disable the "add audio track" button when one already exists, or (b) update the v1-constraint language in the development plan to reflect that multi-audio-track is now intentionally in-scope for this PR.

---

### 3.3  `PlaygroundNav` hardcoded route suppression — layout concern inside a nav component

- [ ] **Discussion needed.**
- **Where:** `apps/web/components/playground/PlaygroundNav.tsx` — `MERGED_ROUTES = new Set(['/playground/production'])`.
- **What:** The nav hides itself for specific child routes by checking the current `pathname` against a hardcoded Set. This couples the nav to knowledge of its children's implementation detail (that `ProductionEditor` renders its own header).
- **Architecture reference:** ARCHITECTURE.md § 9 A5 spirit: avoid abstractions for imaginary consumers, but also don't create fragile special-case coupling. The nav is a layout concern leaking into a navigation component.
- **Fix:** The layout should control whether the nav renders, not the nav itself. Options: (a) pass a boolean `hideNav` prop from `ProductionEditor`'s layout to `PlaygroundLayout`, or (b) use a React context slot that children can set to suppress the nav.

---

### 3.4  `ProductionEditor.tsx` approaching A10 (800-line mega-file)

- [ ] **Watch / consider splitting.**
- **Where:** `apps/web/components/playground/ProductionEditor.tsx` — **624 lines** after this PR.
- **Architecture reference:** ARCHITECTURE.md § 9 A10: "Bad: one mega-component that 'we'll refactor when it gets bigger.' Good: extract before it's painful."
- **What it does:** Houses `TransportBar`, `TimelineControls`, `AspectControl`, `LeftRail`, `PlaygroundTabs`, and the full composition of the Production playground — approximately 6 logical components in one file.
- **Assessment:** Not yet at 800 lines, but the trajectory is clear. Each new feature (media panel, elements panel) that lands on `ProductionEditor` will add more. Extracting the self-contained sub-components (`TransportBar`, `TimelineControls`) into their own files now costs less than after another two feature PRs.

---

## 4  Pre-Existing Documentation Divergence

> These are inconsistencies that existed **before** this dev branch. They are not introduced by this PR and are not blocking merge — but they should be addressed in a follow-up so the docs remain a reliable reference.

### 4.1  `BUNDLE_STRATEGY.md` and `ARCHITECTURE.md § 8` still describe a single-package repo

- [ ] **Not blocking — but the docs are misleading.**
- **BUNDLE_STRATEGY.md:** "The repo is a single package (`@elah/editor`) with three internal layers… No micro-packages."
- **ARCHITECTURE.md § 8:** "Everything lives in one package: `@elah/editor`."
- **ROADMAP.md decisions:** "Single package (`@elah/editor`) | Avoid premature monorepo split; folders, not packages."
- **Reality:** The repo ships **three separate published packages** (`@elah/core`, `@elah/timeline`, `@elah/editor`), each with its own `package.json`, Tailwind pipeline, and compiled `styles.css`. The `README.md` already documents this correctly.
- **Fix:** Update `BUNDLE_STRATEGY.md` to document the three-package strategy and the dependency rule (`@elah/core ← @elah/timeline ← @elah/editor`). Update `ARCHITECTURE.md § 8` to reflect that the "one package" decision was superseded and record why the split was made (independent adoption, `@elah/core` for headless use).

---

### 4.2  `packages/editor/src/core/Architecture.md` references a path that no longer exists

- [ ] **Not blocking — but confusing for new contributors.**
- **Where:** `packages/editor/src/core/Architecture.md` — the directory map and all path references use `packages/editor/src/core/`, `packages/editor/src/timeline/`, etc.
- **Reality:** The core layer now lives in `packages/core/src/`, the timeline layer in `packages/timeline/src/`, and the editor layer in `packages/editor/src/`. A contributor following this Architecture.md will look in the wrong places.
- **Fix:** Either move this file to `packages/core/src/` and update all paths, or replace it with a top-level document that maps the three-package structure.

---

### 4.3  `packages/editor/src/editor/AssetPanel/AssetPanel.tsx` marked deprecated in design plan, still exported

- [ ] **Not blocking — but creates consumer confusion.**
- **Where:** `packages/editor/src/index.ts` exports both `AssetPanel` and `SourcePanel`.
- **Design plan (`02-asset-panel-abstraction.md`):** "Treat `AssetPanel` as deprecated. This workstream builds on `SourcePanel`."
- **Fix:** Add a `@deprecated` JSDoc comment to `AssetPanel`'s export and document the migration path to `SourcePanel` in the editor README.

---

## Summary Table

| # | Category | Severity | File / Scope |
|---|----------|----------|--------------|
| 1.1 | Blocking | CI fails | `packages/timeline/src/ClipBlock.tsx:32-33` |
| 1.2 | Blocking | Public API break | `packages/timeline/src/index.ts` (missing `timelineTheme`) |
| 2.1 | Should fix | Acceptance gap | `packages/editor/src/editor/Preview/StageBorder.tsx:51` |
| 2.2 | Should fix | Acceptance gap | `TextOverlay.tsx:296`, `MediaTransformOverlay.tsx:292` |
| 2.3 | Should fix | Acceptance bar | `apps/web/playground` — raw hex in new components |
| 2.4 | Should fix | Correctness bug | `packages/timeline/src/Ruler.tsx` — `formatRulerLabel` |
| 3.1 | Discuss | API contract | `theme.ts` deletion vs documented facade plan |
| 3.2 | Discuss | Engine honesty | Multi-audio-track UI vs v1 renderer constraint |
| 3.3 | Discuss | Altitude | `PlaygroundNav.tsx` — hardcoded route suppression |
| 3.4 | Watch | A10 risk | `ProductionEditor.tsx` (624 lines, growing) |
| 4.1 | Pre-existing | Doc divergence | `BUNDLE_STRATEGY.md`, `ARCHITECTURE.md § 8` |
| 4.2 | Pre-existing | Doc divergence | `packages/editor/src/core/Architecture.md` paths |
| 4.3 | Pre-existing | Doc divergence | `AssetPanel` deprecation not signaled in exports |
