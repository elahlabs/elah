# 01 — Unified Design System

> **Problem (requirement #1):** three design systems are fighting. Unify them.

## Current state — the three systems

| #   | System          | Where                                                                                  | Shape                                                              | Palette                                                       |
| --- | --------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| A   | `timelineTheme` | [`packages/timeline/src/theme.ts`](../../packages/timeline/src/theme.ts)               | **JS object, hardcoded hex**                                       | _cool_ blue-black (`#0A0D14`, blue clips, `#FF2D55` playhead) |
| B   | `--elah-*`      | [`packages/editor/src/styles/tokens.css`](../../packages/editor/src/styles/tokens.css) | **CSS variables**                                                  | _warm_ charcoal (`#0a0909`, crimson `#e03050`)                |
| C   | `--color-*`     | [`apps/web/styles/globals.css`](../../apps/web/styles/globals.css)                     | **CSS variables**, light + `.dark`, maps `.elah-root` → `--elah-*` | Material-ish warm, theme-switching                            |

### How they actually conflict (not cosmetic — structural)

1. **Duplicated tokens that can drift.** Clip colors and the playhead exist in
   _both_ A and B:
   - `theme.ts` `clip.video = { top:#3B82F6, mid:#2563EB, … }` **and**
     `tokens.css` `--elah-clip-video-top:#3b82f6` … — same values, two owners.
   - `theme.ts` `playhead:'#FF2D55'` **and** `tokens.css` `--elah-playhead:#ff2d55`.
     Two sources of truth for one visual fact is the definition of "fighting."
2. **Surfaces disagree.** Timeline surface is cool (`#0A0D14`); editor panel
   surface is warm (`#0a0909`/`--elah-bg`). The timeline visibly does not match the
   panels docked next to it.
3. **Timeline can't theme-switch.** B and C respond to light/dark via the
   `.elah-root` → `--color-*` mapping. A is static JS, so the **timeline is locked
   dark** while the surrounding panels follow the app theme — a literal in-product
   fight, and a hard blocker for the live-themeable docs goal.
4. **Raw-hex debt in editor components** (outside the token file): toast colors in
   [`AssetPanel.tsx`](../../packages/editor/src/editor/AssetPanel/AssetPanel.tsx) /
   [`SourcePanel.tsx`](../../packages/editor/src/editor/SourcePanel/SourcePanel.tsx)
   (`#f5d0a9`, `#3a2418`, `#1a2433`, `#355070`, `#7a4a2a`), and selection chrome in
   [`TextOverlay.tsx`](../../packages/editor/src/editor/Preview/TextOverlay.tsx)
   (`#4c9aff`, `#fff`). ~14 literals across editor components.
5. **The Preview is a fourth, un-tokenized pocket — and it disagrees with the
   accent.** [`Preview.tsx`](../../packages/editor/src/editor/Preview/Preview.tsx)
   hardcodes the stage backdrop `#06070A`;
   [`StageBorder.tsx`](../../packages/editor/src/editor/Preview/StageBorder.tsx)
   draws the frame outline + glow in `rgba(225,29,72,…)` — a crimson that is **not**
   the token accent `--elah-accent:#e03050`; and both interaction overlays
   ([`TextOverlay`](../../packages/editor/src/editor/Preview/TextOverlay.tsx),
   [`MediaTransformOverlay`](../../packages/editor/src/editor/Preview/MediaTransformOverlay.tsx))
   paint **blue** `#4c9aff` selection handles that clash with the crimson system.
   So even the "selected" color means two different things in two surfaces.

## Decision (direction set; confirm specifics with Paul before editing the token files)

**CSS custom properties are the single source of truth.** They already carry the
two things JS tokens can't: cascade-based light/dark theming and host-app
overrides. This is also forced by the live-themeable docs goal (a docs page can
restyle the editor by setting CSS vars; it cannot reach into a frozen JS object).

> ⚠️ `theme.ts` and `tokens.css` are load-bearing and consumed widely. Confirm the
> exact variable names + the migration cutover with Paul before editing either —
> see the project note on the timeline token split.

### Target architecture

```
apps/web/styles/globals.css      ──┐ (host overrides --color-* and/or --elah-*)
                                   │
packages/editor/src/styles/       ──┤  ONE canonical token layer:
  tokens.css  (--elah-*)           │  --elah-* defaults, themeable, the source
                                   │  of truth for EVERY package.
                                   ▼
timeline components ──reads── timelineTheme  (now a thin var() facade)
editor components   ──reads── --elah-* directly
```

Key move: **keep the `timelineTheme` API, re-point its values at the CSS vars.**
86 references across 8 timeline components use `timelineTheme.<group>.<token>` —
do not churn them. Instead each value becomes the variable string:

```ts
// theme.ts — after
export const timelineTheme = {
  clip: {
    video: {
      top: 'var(--elah-clip-video-top)',
      mid: 'var(--elah-clip-video-mid)',
      bottom: 'var(--elah-clip-video-bottom)',
      accent: 'var(--elah-clip-video-accent)',
    },
    // …
  },
  playhead: 'var(--elah-playhead)',
} as const
```

Components keep working unchanged; the values now resolve through the cascade, so
the timeline finally theme-switches and matches the panels. The duplicated hex in
`theme.ts` is deleted — `tokens.css` becomes the only place the literals live.

Any token the timeline needs that `tokens.css` doesn't yet define (e.g. the
`popover`, `dialog`, `effect`, `transition` groups) is **added to `tokens.css`**
as new `--elah-*` variables, then referenced from `theme.ts`. Net result: one
literal palette, in one file, themeable.

## Surface coverage — the token contract spans the **whole** editor

The unification is not "fix the timeline." The token layer must reach **every**
surface a developer sees, so re-theming is one consistent operation. Each surface
below must read from `--elah-*` after this workstream:

| Surface                          | Files                                             | Tokens it needs (add to `tokens.css` where missing)                                                                                                                               |
| -------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Timeline**                     | `packages/timeline/src/*` via `timelineTheme`     | clip ramps, surfaces, ruler, playhead, menu, popover, dialog, transition, effect                                                                                                  |
| **Asset / media panel**          | `SourcePanel.tsx` (+ deprecated `AssetPanel.tsx`) | surfaces, card, kind tags, chips, **toast** (`--elah-toast-info-*`, `--elah-toast-warn-*`), accent                                                                                |
| **Elements panel**               | `ElementsPanel.tsx` / Elements lane               | element-tile tags (`--elah-tag-text-*` exists; extend per future element)                                                                                                         |
| **Preview**                      | `Preview.tsx`, `StageBorder.tsx`                  | `--elah-stage-bg` (backdrop), `--elah-stage-frame` + `--elah-stage-frame-glow` (outline) — **route the StageBorder accent to the token accent so it stops being a third crimson** |
| **Overlays (selection chrome)**  | `TextOverlay.tsx`, `MediaTransformOverlay.tsx`    | `--elah-selection-ring`, `--elah-selection-handle`, `--elah-selection-handle-border` — one "selected" color across both, derived from the system accent                           |
| **Inspector (right text panel)** | new in [`03`](./03-text-editing-and-inspector.md) | surfaces, control bg/border/focus, label text, section divider — **must be built on tokens from day one, zero hex**                                                               |

> The Inspector ([`03`](./03-text-editing-and-inspector.md)) and Preview-overlay
> work land alongside this doc: anything new they introduce is defined here as
> `--elah-*` first, never as a literal that "we'll tokenize later."

## Developer configuration — the DX goal

The point of unifying is that **a developer can configure their design system with
ease** across Preview, the right-hand Inspector, the asset panel, the timeline —
all of it — from **one place**:

```css
/* The consumer's stylesheet — re-theme the ENTIRE editor, no JS. */
.elah-root {
  --elah-accent: #6366f1; /* recolors selection chrome, chips, StageBorder, buttons */
  --elah-bg-panel: #1e1e2e; /* every panel surface: asset, inspector, timeline sidebar */
  --elah-stage-bg: #0b0b12; /* the Preview backdrop */
  --elah-radius-md: 10px; /* geometry flows everywhere too */
}
```

Two requirements make this real:

1. **Complete + documented contract.** Every `--elah-*` variable is listed in
   [`docs/design-tokens.md`](../design-tokens.md) grouped **by surface** (Preview /
   Asset / Inspector / Timeline / shared), with its role — so a developer knows
   exactly which knob changes which surface. No undocumented literal anywhere.
2. **Single override point.** All surfaces inherit from `.elah-root`; overriding a
   variable there cascades into all packages. The host overrides at `.elah-root`
   (or maps `--color-*` → `--elah-*` as the web app already does in
   [`globals.css`](../../apps/web/styles/globals.css)).

**Optional ergonomic layer (stretch):** an `EditorTheme` prop on `EditorProvider`
that applies a token object as inline CSS variables on the editor root — sugar for
developers who prefer passing an object over writing CSS. It must compile **down to
the same `--elah-*` variables** (a thin `style={{ '--elah-accent': … }}` writer),
never a parallel JS theme system. CSS variables stay the mechanism; this is just a
typed convenience over them, and it converges with the Phase-2 `EditorTheme` idea
in `ROADMAP.md`.

## Tasks

1. **Audit + map.** Produce a table mapping every `theme.ts` token → an
   `--elah-*` variable (existing or new). Reconcile the cool-vs-warm surface
   conflict here — pick one surface ramp (recommend the warm `--elah-bg*` ramp,
   since it already theme-switches) and retire the cool timeline surfaces.
2. **Extend `tokens.css`** with the missing groups (`transition`, `menu`,
   `popover`, `dialog`, `danger`, `effect`) as `--elah-*` vars + JSDoc-equivalent
   comments. Keep the role-based grouping the current `theme.ts` already uses.
3. **Re-point `theme.ts`** values to `var(--elah-*)` strings; delete the literals.
   Keep the object shape + `TimelineTheme` type so component code is untouched.
4. **Sweep every editor-component hex** across all surfaces in the coverage table:
   - asset/source **toasts** → `--elah-toast-*`;
   - **Preview** backdrop `#06070A` → `--elah-stage-bg`;
   - **StageBorder** `rgba(225,29,72,…)` → `--elah-stage-frame` / `-glow`, routed
     to the **token accent** (kills the third crimson);
   - **selection chrome** in `TextOverlay` + `MediaTransformOverlay` (`#4c9aff`,
     `#fff`) → one shared `--elah-selection-*` derived from the accent.
5. **Inspector on tokens** — coordinate with [`03`](./03-text-editing-and-inspector.md)
   so the new right-hand panel reads `--elah-*` from its first commit (no hex to
   sweep later).
6. **(Stretch) `EditorTheme` prop** on `EditorProvider` that writes a token object
   as inline `--elah-*` CSS variables on the editor root — typed sugar over the
   cascade, not a parallel system.
7. **Verify light mode + cross-surface re-theme.** In light mode the timeline must
   recolor with the panels (headline regression). Then prove a single `.elah-root`
   override visibly re-themes Preview + Inspector + asset panel + timeline together.
8. **Update docs.** Rewrite [`docs/design-tokens.md`](../design-tokens.md): single
   source is `tokens.css`; document the full `--elah-*` contract **grouped by
   surface** (Preview / Asset / Inspector / Timeline / shared); `timelineTheme` is
   a typed read-facade over it.

## Out of scope / guardrails

- Don't change _which_ hues things are unless the surface-reconciliation in task 1
  requires it — this is a unification, not a re-skin.
- Don't introduce a JS theme provider/context; the cascade is the mechanism.
- Don't break the published `timelineTheme` / `TimelineTheme` exports — third
  parties may import them.

## Acceptance criteria

- [ ] Exactly **one** file contains color literals for the editor + timeline
      (`tokens.css`); `theme.ts` contains zero hex.
- [ ] Toggling app light/dark recolors the timeline _and_ panels together.
- [ ] No raw hex in any timeline/editor **component** file (`grep '#[0-9a-fA-F]'`)
      — **including** `Preview`, `StageBorder`, both overlays, and the Inspector.
- [ ] "Selected" is **one** color across Preview overlays, asset cards, and the
      timeline; StageBorder uses the token accent (no third crimson).
- [ ] `timelineTheme.*` call sites compile unchanged; visual diff is ~nil in dark.
- [ ] **One `.elah-root` override visibly re-themes all four surfaces at once** —
      Preview, Inspector, asset panel, timeline — with no JS. Proven by a
      docs/playground example.
- [ ] `docs/design-tokens.md` lists the full `--elah-*` contract grouped by surface,
      so a developer can find which knob changes which surface.
