# Design Tokens

> Every color, border, shadow and overlay in the Elah editor UI flows through one
> contract: the **`--elah-*` CSS variables**. Components never inline color
> literals — they use a Tailwind token class (e.g. `bg-ed-panel`) or a
> `var(--elah-*)` reference. Re-skinning the editor (light theme, brand match,
> white-label) means overriding those variables in one place.

---

## The model

There are two variable families, bridged so the editor works in both worlds:

| Family | Defined in | Used by |
| --- | --- | --- |
| `--color-*` | `apps/web/styles/globals.css` (`:root` / `.dark`) | the website's own chrome (marketing, docs) |
| `--elah-*` | `@elah/editor/styles/tokens.css` (standalone) **or** the `.elah-root` block in `globals.css` (embedded) | the editor + timeline packages |

- **Embedded in the website:** `globals.css` defines `.elah-root { --elah-*: var(--color-*) }`, so the editor inherits the site's light/dark theme automatically.
- **Standalone (any vendor app):** import `@elah/editor/styles/tokens.css`, which sets `.elah-root { --elah-*: <dark defaults> }`. No website design system required.

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

## Token groups

| Group (`--elah-…`) | Purpose |
| --- | --- |
| `bg`, `bg-secondary`, `bg-panel`, `bg-card`, `bg-elevated`, `bg-highest` | Structural surfaces (canvas, lanes, panels, cards, menus, chips) |
| `border`, `border-subtle`, `outline` | Hairlines and interactive/focus edges |
| `text`, `text-muted`, `text-on-clip` | Foreground text + label on a colored clip |
| `accent*` | Primary accent (hover/dim/glow/soft/text variants) |
| `clip-{video,audio,text,image}-{top,mid,bottom,accent}` | Per-clip-type gradient ramp + accent |
| `tag-*` | Asset/element kind chips (fg/bg per kind) |
| `playhead`, `tick-color`, `tick-label` | Playhead needle, ruler ticks and labels |
| `selection-{border,glow}` | Selected-clip highlight |
| `transition-*` | Cut-line + diamond marker states (line/hover/idle/fill/stroke/add) |
| `menu-*`, `popover-*`, `dialog-*` | Context menu, transition picker popover, blocking dialog |
| `danger-*` | Destructive actions (delete / remove) |
| `effect-*` | Reusable overlays — glosses, inset highlights, scrims, drop shadows |
| `preview-bg`, `stage-{border,glow}`, `selection-{color,handle}` | Preview canvas + media-transform overlay affordances |

## Adding or changing a token

1. Add/edit the variable in **both**
   [`packages/editor/src/styles/tokens.css`](../packages/editor/src/styles/tokens.css)
   (standalone dark default) **and** the `.elah-root` block in
   [`apps/web/styles/globals.css`](../apps/web/styles/globals.css) (app value —
   map to a `--color-*` token when it's a neutral surface/text/border; keep a
   literal for intrinsic accents like the selection red).
2. If you want a named Tailwind class for it (vs `[var(--elah-x)]`), add the
   color to [`tailwind.preset.ts`](../tailwind.preset.ts).
3. Reference it from components as a token class or `var(--elah-*)` — **never** a
   raw hex literal. The `npm run lint:tokens` guard enforces this for package
   components.

## Deprecated: `timelineTheme`

`packages/timeline/src/theme.ts` (the old `timelineTheme` object of hex literals)
is **deprecated** but still exported for backward compatibility. Components no
longer use it; new code must use the `--elah-*` contract above.
