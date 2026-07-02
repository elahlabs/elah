# Design Tokens

> Every color, border, shadow and overlay in the Elah editor UI flows through one
> contract: the **`--elah-*` CSS variables**. Components never inline color
> literals — they use a Tailwind token class (e.g. `bg-ed-panel`) or a
> `var(--elah-*)` reference. Re-skinning the editor (light theme, brand match,
> white-label) means overriding those variables in one place.

---

## The model

There are two variable families:

| Family      | Defined in                                                                                                     | Used by                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `--color-*` | `apps/web/styles/globals.css` (`:root` / `.dark`)                                                              | the website's own chrome (marketing, docs) |
| `--elah-*`  | `@elah/editor/styles/tokens.css` (standalone) **or** the `.elah-root` block in `globals.css` (this repo's app) | the editor + timeline packages             |

Whoever defines `--elah-*` decides the editor's look. There are three ways to do it:

1. **This website (current):** the `.elah-root` block in `globals.css` pins
   `--elah-*` to a **fixed cool blue-gray scheme**, intentionally **decoupled**
   from the site's warm `--color-*` light/dark theme — the editor reads as a dark
   tool surface in both modes.
2. **Standalone / vendor:** import `@elah/editor/styles/tokens.css`, which sets
   `.elah-root { --elah-*: <warm-charcoal dark defaults> }`. No design system
   required.
3. **Inherit a host theme (optional pattern):** map `--elah-*` onto your own
   tokens, e.g. `.elah-root { --elah-bg-panel: var(--color-surface-low); … }`, so
   the editor follows your app's light/dark automatically. (This repo used to do
   this before switching to mode 1.)

In every case the components are identical; only the `--elah-*` values differ.

Authoring happens in Tailwind. The repo-root `tailwind.preset.ts` maps token
classes to these variables (`bg-ed-panel` → `var(--elah-bg-panel)`,
`bg-clip-video-top` → `var(--elah-clip-video-top)`, etc.). Each package compiles
the classes its components use into a shipped `dist/styles.css` (preflight off —
no global reset leaks into a consumer).

## Consuming the packages

```ts
// 1. token values — pick ONE source:
import '@elah/editor/styles/tokens.css' // standalone dark defaults, OR
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
  --elah-accent: #6366f1; /* indigo brand */
  --elah-bg-panel: #1e1e2e;
  --elah-playhead: #f43f5e;
}
```

The full variable list is the public theming surface — see
[`tokens.css`](../packages/editor/src/styles/tokens.css).

### Per-instance: the `classNames` prop

Tokens recolor every editor instance globally. For a _single_ component, pass a
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

| Group (`--elah-…`)                                                       | Purpose                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `bg`, `bg-secondary`, `bg-panel`, `bg-card`, `bg-elevated`, `bg-highest` | Structural surfaces (canvas, lanes, panels, cards, menus, chips)    |
| `border`, `border-subtle`, `outline`                                     | Hairlines and interactive/focus edges                               |
| `text`, `text-muted`, `text-on-clip`                                     | Foreground text + label on a colored clip                           |
| `accent*`                                                                | Primary accent (hover/dim/glow/soft/text variants)                  |
| `clip-{video,audio,text,image}-{top,mid,bottom,accent}`                  | Per-clip-type gradient ramp + accent                                |
| `tag-*`                                                                  | Asset/element kind chips (fg/bg per kind)                           |
| `playhead`, `tick-color`, `tick-label`                                   | Playhead needle, ruler ticks and labels                             |
| `selection-{border,glow}`                                                | Selected-clip highlight                                             |
| `transition-*`                                                           | Cut-line + diamond marker states (line/hover/idle/fill/stroke/add)  |
| `menu-*`, `popover-*`, `dialog-*`                                        | Context menu, transition picker popover, blocking dialog            |
| `danger-*`, `color-error`                                                | Destructive actions (delete / remove) + generic error text          |
| `info-{bg,border,text}`                                                  | Informational toast (e.g. "skipped N duplicates")                   |
| `effect-*`                                                               | Reusable overlays — glosses, inset highlights, scrims, drop shadows |
| `preview-bg`, `stage-{border,glow}`, `selection-{color,handle}`          | Preview canvas + media-transform overlay affordances                |

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
