# Design Tokens

> Every color, border, shadow and overlay in the Elah editor UI flows through one
> contract: the **`--elah-*` CSS variables**. Components never inline color
> literals — they use a Tailwind token class (e.g. `bg-ed-panel`) or a
> `var(--elah-*)` reference. Re-skinning the editor (light theme, brand match,
> white-label) means overriding those variables in one place.

---

## The model

There are two variable families:

| Family | Defined in | Used by |
| --- | --- | --- |
| `--color-*` | `apps/web/styles/globals.css` (`:root` / `.dark`) | the website's own chrome (marketing, docs, playgrounds) |
| `--elah-*` | `@elah/editor/styles/tokens.css` (standalone) **or** the `.elah-root` block in `globals.css` (this repo's app) | the editor + timeline packages |

Whoever defines `--elah-*` decides the editor's look. There are three ways to do it:

1. **This website (current):** the `.elah-root` block in `globals.css` pins
   `--elah-*` to a **fixed cool blue-gray scheme**, intentionally **decoupled**
   from the site's `--color-*` light/dark theme — the editor reads as a dark
   tool surface in both modes.
2. **Standalone / vendor:** import `@elah/editor/styles/tokens.css`, which sets
   `.elah-root { --elah-*: <warm-charcoal dark defaults> }`. No design system
   required.
3. **Inherit a host theme (optional pattern):** map `--elah-*` onto your own
   tokens, e.g. `.elah-root { --elah-bg-panel: var(--color-surface-low); … }`, so
   the editor follows your app's light/dark automatically. (This repo used to do
   this before switching to mode 1.)

In every case the components are identical; only the `--elah-*` values differ.

### The site's `--color-*` palette

The site chrome uses one edit-bay palette: neutral paper and ink, with cyber red
(`#FF003C`) reserved for selection, record and the playhead — never body text
(it fails contrast on paper). Light values sit on `:root`; the `.dark` class on
`<html>` (toggled by the shared nav's theme toggle, stored in `localStorage` as
`elah-theme`) swaps them. Cyber red is identical in both themes; text on red is
always ink `#0E0E10`.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--color-surface` | `#F0EFEA` | `#0C0C0E` | Paper (page background) |
| `--color-surface-dim` | `#DEDCD5` | `#0C0C0E` | Pressed surface |
| `--color-surface-low` / `-lowest` | `#F7F6F2` / `#FBFAF7` | `#121215` / `#08080A` | Cards / deepest layer |
| `--color-surface-container` / `-high` / `-highest` | `#E8E6E0` / `#E8E6E0` / `#DEDCD5` | `#18181B` / `#1E1E22` / `#26262B` | Hover bands / lifted panels |
| `--color-surface-bright` | `#F7F6F2` | `#26262B` | Brightest step |
| `--color-on-surface` | `#0E0E10` | `#EDECE7` | Ink text, primary button fill |
| `--color-on-surface-variant` | `#5E5D58` | `#9C9B95` | Muted text (5.7:1 on paper) |
| `--color-inverse-surface` / `-on-surface` | `#0E0E10` / `#F0EFEA` | `#EDECE7` / `#0C0C0E` | Inverted fills (toasts, chips) |
| `--color-outline` | `#9A9993` | `#3A3A40` | Strong hairline / focus edge |
| `--color-outline-variant` | `#D9D7D0` | `#2A2A2F` | Everyday hairline |
| `--color-outline-subtle` | `#E4E2DC` | `#1E1E22` | Faint divider |
| `--color-primary` / `-hover` / `-dim` | `#FF003C` / `#D10030` / `#FF003C` | `#FF003C` / `#FF335F` / `#FF6685` | Cyber red ramp |
| `--color-on-primary` | `#0E0E10` | `#0E0E10` | Ink on red |
| `--color-focus-ring` | `#FF003C` | `#FF003C` | Focus ring (red — the outline token is too faint for WCAG 1.4.11) |

Full values and usage rules live in
[`apps/web/components/landing/home/DESIGN.md` §0](../apps/web/components/landing/home/DESIGN.md)
(the site-wide design system).

Authoring happens in Tailwind. The repo-root `tailwind.preset.ts` maps token
classes to these variables (`bg-ed-panel` → `var(--elah-bg-panel)`,
`bg-clip-video-top` → `var(--elah-clip-video-top)`, etc.). Each package compiles
the classes its components use into a shipped `dist/styles.css` (preflight off —
no global reset leaks into a consumer).

## Consuming the packages

```ts
// 1. token values — pick ONE source:
import '@elah/editor/styles/tokens.css'   // standalone dark defaults, OR
// (when embedding in an app that already defines .elah-root, skip this)

// 2. compiled component styles — always import both:
import '@elah/timeline/styles.css'
import '@elah/editor/styles.css'
```

These are plain CSS files. The consumer does **not** need Tailwind, and no utility
class names (`.flex`, `.p-2`) are exposed — only each package's own compiled rules.

## Theming / white-label

Override any `--elah-*` variable in your own `.elah-root` scope:

```css
.elah-root {
  --elah-accent:   #6366f1;   /* indigo brand */
  --elah-bg-panel: #1e1e2e;
  --elah-playhead: #f43f5e;
}
```

The full variable list is the public theming surface — see
[`tokens.css`](../packages/editor/src/styles/tokens.css).

### Per-instance: the `classNames` prop

Tokens recolor every editor instance globally. For a *single* component, pass a
`classNames` prop — a per-slot map of Tailwind classes that wins over the
defaults (via `tailwind-merge`). Two components expose one:

- **`<Timeline classNames>`** — slots for ruler, tracks, lanes, per-clip-type
  body + accent, and the playhead (`TimelineClassNames`). See the
  [`@elah/timeline` README](../packages/timeline/README.md#per-instance-overrides--classnames).
- **`<SourcePanel classNames>`** — slots for the tab bar, control bars, ingest
  buttons, search, sort chips, media cards, kind badges (per kind), element
  tiles, dropzone, toast and errors (`SourcePanelClassNames`).

Convention in both: `bg-*`/gradients recolor surfaces and clip bodies; `text-*`
recolors accents (playhead, clip stripe, track bar, kind badges) — they paint
from `currentColor`.

## Token groups

| Group (`--elah-…`) | Purpose |
| --- | --- |
| `bg`, `bg-secondary`, `bg-panel`, `bg-card`, `bg-elevated`, `bg-highest` | Structural surfaces (canvas, lanes, panels, cards, menus, chips) |
| `border`, `border-subtle`, `outline` | Hairlines and interactive/focus edges |
| `text`, `text-muted`, `text-on-clip` | Foreground text + label on a colored clip |
| `accent*` | Primary accent (hover/dim/glow/soft/text variants) |
| `clip-{video,audio,text,image,shape,freehand}-{top,mid,bottom,accent}` | Per-clip-type gradient ramp + accent |
| `tag-*` | Asset/element kind chips (fg/bg per kind: video, audio, image, text, shape, freehand; text, shape and freehand also carry a border) |
| `font-ui`, `font-mono`, `radius-sm`, `radius-md` | UI and monospace font stacks, small and medium corner radii |
| `playhead`, `tick-color`, `tick-label` | Playhead needle, ruler ticks and labels |
| `selection-{border,glow}` | Selected-clip highlight |
| `transition-*` | Cut-line + diamond marker states (line/hover/idle/fill/stroke/add) |
| `menu-*`, `popover-*`, `dialog-*` | Context menu, transition picker popover, blocking dialog |
| `danger-*`, `color-error` | Destructive actions (delete / remove) + generic error text |
| `info-{bg,border,text}` | Informational toast (e.g. "skipped N duplicates") |
| `toast-shadow` | Drop shadow under the asset/source panel toasts, `0 4px 12px rgba(0,0,0,.35)` |
| `effect-*` | Reusable overlays — glosses, inset highlights, scrims, drop shadows |
| `preview-bg`, `stage-{border,glow}`, `selection-{color,handle}` | Preview canvas + media-transform overlay affordances |
| `overlay-scrim`, `overlay-text` | Full-stage scrim (`rgba(0,0,0,.7)`) and its text — GL-context recovery layer, loading error label |
| `overlay-border`, `overlay-bg`, `overlay-bg-hover` | Ghost button drawn on the scrim (Reload preview) |
| `spinner-track`, `spinner-head` | Preview loading spinner ring and its leading arc |
| `clip-badge-bg` | Backing pill for small clip badges (e.g. the speed badge), `rgba(0,0,0,.55)` |

## Adding or changing a token

1. Add/edit the variable in **both**
   [`packages/editor/src/styles/tokens.css`](../packages/editor/src/styles/tokens.css)
   (the standalone/vendor warm-charcoal default) **and** the `.elah-root` block in
   [`apps/web/styles/globals.css`](../apps/web/styles/globals.css) (the app's fixed
   cool blue-gray value). Keep the two in sync in structure; the literal values
   differ by scheme.
2. If you want a named Tailwind class for it (vs `[var(--elah-x)]`), add the
   color to [`tailwind.preset.ts`](../tailwind.preset.ts).
3. Reference it from components as a token class or `var(--elah-*)` — **never** a
   raw hex literal. The `npm run lint:tokens` guard enforces this for package
   components.
