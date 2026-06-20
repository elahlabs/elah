# Timeline Design Tokens

> Every color, border, shadow and overlay used by the timeline UI lives in one
> place: [`packages/timeline/src/theme.ts`](../packages/timeline/src/theme.ts).
> Components import `timelineTheme` instead of inlining literals, so re-skinning
> the entire timeline (a light theme, brand match, etc.) means editing one object.

---

## Why

Before this, colors were hard-coded across every timeline component (`ClipBlock`,
`Ruler`, `Playhead`, dialogs, pickers…). Changing the look meant hunting literals
through many files and risking drift between components that should match.

`timelineTheme` makes the token set the **single source of truth**. Tokens are
grouped **by role, not by component**, so the same visual meaning (e.g. "muted
text") is one token reused everywhere rather than five copies.

## Usage

```ts
import { timelineTheme, type TimelineTheme } from '@elah/timeline'

const laneBg = timelineTheme.surface.background
const videoAccent = timelineTheme.clip.video.accent
```

Both the `timelineTheme` object and the `TimelineTheme` type are exported from the
package entry ([`packages/timeline/src/index.ts`](../packages/timeline/src/index.ts)).

## Token groups

| Group | Purpose |
| --- | --- |
| `surface` | Background fills for structural surfaces (lanes, sidebar, ruler), incl. active variants |
| `border` | Hairline dividers — `strong` (vertical rules) and `subtle` (row separators) |
| `text` | Foreground text ramp, brightest → faintest (`primary`…`hint`, plus `onClip`) |
| `clip` | Per-clip-type color ramp (`video`/`audio`/`text`/`image`), each with `top`/`mid`/`bottom` gradient + `accent` |
| `selection` | Selected-clip highlight (`border` + outer `glow`) |
| `playhead` | Playhead needle color (line, handle, glow) |
| `ruler` | Ruler `tick` marks and timecode `label`s |
| `transition` | Cut-line + diamond marker states (exists / hover / idle) |
| `menu` | Clip right-click context menu |
| `popover` | Transition picker popover (incl. option idle/hover/active states) |
| `dialog` | Blocking "video has audio" choice dialog (overlay, buttons, primary action) |
| `danger` | Destructive actions (delete clip / remove transition) |
| `effect` | Reusable light/dark overlays — glosses, inset highlights, scrims, drop shadows |

## Adding or changing a token

1. Edit the relevant group in [`theme.ts`](../packages/timeline/src/theme.ts).
   Add a token where the **visual role** fits; don't duplicate an existing one.
2. Keep the JSDoc comment on each token current — it's the inline reference for
   what the token means.
3. Reference it from components via `timelineTheme.<group>.<token>`. Never
   re-introduce a color literal in a component file.
4. `TimelineTheme` is derived from the object (`typeof timelineTheme`), so new
   tokens are typed automatically.
