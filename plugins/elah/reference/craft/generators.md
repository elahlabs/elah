# Generators for data: counter, barChart, progressBar

A `generator` element is `{ "kind": "generator", "generator": "<kind>", "at", "duration", "x", "y", "w", "h", "params": [ { "name", "value" } ] }`.
`x`, `y` is the centre, and the clip is the whole animation: it starts at `at`, fills inside its own `duration`, and disappears when
the clip ends. So make `duration` last to the end of the beat, and tune how much of it the fill takes with the fraction params below.
Colour params are hex literals, not tokens (`"#5eead4"`, copy the palette value). This is the one exception to the director's
"never hex in an element" rule: element fields (`color`, `fill`, `stroke`) still take `$tokens`, and if you change the palette, change
these copied hex values too. Give each one `"enter": "fade-in"`, or polish pops
it from 35% scale.

## How long each one takes (read from the engine's painter)

| Generator | Fill window | Shape | Then |
| --- | --- | --- | --- |
| `counter` | `countFraction` x the clip (default 0.7, range 0.05-1) | ease-out cubic from `from` to `to`: 87% of the change in the first half of the window | holds `to` until the clip ends |
| `barChart` | `growFraction` x the clip (default 0.5, range 0.05-1) | bar `i` of `n` starts at `i x window/(n+2)` and takes `2 x window/(n+2)`, ease-out cubic; the last bar is full at `window x (n+1)/(n+2)` | holds every bar full |
| `progressBar` | the whole clip, no fraction param | `from + (to - from) x ease-out cubic`, the last frame is exactly `to` | nothing: the clip ends |

Fill-then-hold, with `D` the clip length and `c` the seconds you want the fill to take:

- `counter`: `countFraction = c / D`. A 1.4 s count in a 5.6 s clip is 0.25. The house rule (count 1.2-1.6 s, hold at least 1.5 s)
  means `D >= c + 1.5`; `countFraction 0.6` in a 4 s clip counts for 2.4 s, which is slow.
- `barChart`: last bar full at `c` means `growFraction = c x (n+2) / ((n+1) x D)`: four bars full at 1.5 s in a 5.7 s clip is 0.3.
- `progressBar` has no hold. Use two rects instead: a dim track and a fill with `anchor { x: 0, y: 0.5 }`, `x` at the bar's left edge
  and a `scaleX` key from 0 to the final fraction (`cubic-out`, 1.2-1.6 s): the last key holds. (A progressBar clip works only when
  filling over the whole beat is what you want.)

## Other facts

- `counter` paints in the system sans at weight 800 whatever your design fonts are (`big-number` and `stat-ring` use the same
  painter). `suffix` defaults to `+` and `separator` to on: set `"suffix": ""` (or `%`, `k`) and `decimals` yourself. The lint
  reads text `size` only, so a `fontSize` of 200-400 is fine.
- `barChart` takes `values` as one string (`"40, 65, 52, 90"`, at most 24); the tallest bar is `height` (a fraction of the stage,
  default 0.35) and the row is `width` wide (default 0.5). One `color` for all bars (a highlighted bar needs `stat-bars`); value
  labels are white and follow the bars, so set `showValues` false on a light background.
- Order: the number lands, then its label arrives (0.3-0.5 s later), then the context. Never two counters counting at once.

```json
{
  "format": "elah-input", "version": 1, "title": "Fill then hold",
  "source": { "kind": "spec", "spec": {
    "version": 1, "title": "Fill then hold", "format": { "width": 1080, "height": 1920, "fps": 30 }, "duration": 6,
    "background": "$bg", "motion": { "energy": "standard", "camera": false, "ambient": "none", "transition": "cut" },
    "design": {
      "colors": [ { "name": "bg", "value": "#0b0f14" }, { "name": "ink", "value": "#f4f6f8" }, { "name": "muted", "value": "#8a94a3" },
        { "name": "accent", "value": "#5eead4" }, { "name": "accentSoft", "value": "#134e4a" }, { "name": "surface", "value": "#151b24" } ],
      "fonts": [ { "role": "sans", "font": "inter" } ]
    },
    "elements": [
      { "id": "g-count", "kind": "generator", "generator": "counter", "at": 0, "duration": 6, "w": 900, "h": 300, "x": 0.5, "y": 0.25,
        "params": [ { "name": "to", "value": 1200 }, { "name": "countFraction", "value": 0.25 }, { "name": "fontSize", "value": 240 },
          { "name": "color", "value": "#f4f6f8" } ], "enter": "fade-in" },
      { "id": "g-bars", "kind": "generator", "generator": "barChart", "at": 0.3, "duration": 5.7, "w": 900, "h": 500, "x": 0.5, "y": 0.5,
        "params": [ { "name": "values", "value": "40, 65, 52, 90" }, { "name": "growFraction", "value": 0.3 }, { "name": "width", "value": 0.7 },
          { "name": "height", "value": 0.2 }, { "name": "color", "value": "#5eead4" } ], "enter": "fade-in" },
      { "id": "g-track", "kind": "shape", "shape": "rect", "at": 0.6, "duration": 5.4, "w": 756, "h": 24, "radius": 12, "fill": "$muted",
        "opacity": 0.35, "x": 0.5, "y": 0.7, "enter": "fade-in" },
      { "id": "g-fill", "kind": "shape", "shape": "rect", "at": 0.8, "duration": 5.2, "w": 756, "h": 24, "radius": 12, "fill": "$accent",
        "anchor": { "x": 0, "y": 0.5 }, "x": 0.15, "y": 0.7, "enter": "fade-in",
        "keys": [ { "channel": "scaleX", "at": 0, "value": 0 }, { "channel": "scaleX", "at": 1.4, "value": 0.72, "curve": "cubic-out" } ] },
      { "id": "g-label", "kind": "text", "at": 1, "duration": 5, "text": "72% of the way there", "font": "$sans", "size": 48, "color": "$ink",
        "maxWidth": 800, "x": 0.5, "y": 0.62, "enter": "fade-in" }
    ]
  } }
}
```
