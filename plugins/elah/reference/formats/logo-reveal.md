# Format: Logo sting (`logo-reveal`; sting, intro, end card)

3-6 s (default 4). No cuts, one camera push, one effect on the mark. With no logo file the mark is the wordmark in type: never draw
or imitate a logo, and use an `image` only when the user gave a URL (then it stays unmodified).

## Beat table (4 s)

The last column is the programmatic video (the default medium); the column before it is the VideoSpec alternative. The whole
programmatic beat is one recipe, [Logo outro](../programmatic/recipes.md#logo-outro): a wordmark in type, an accent ring stroke drawn
round it, a tagline below the ring.

| Beat | Seconds | Job | What fits (VideoSpec) | Programmatic recipe (`programmatic/recipes.md`) |
| --- | --- | --- | --- | --- |
| Build | 0-1.2 | something already on screen at frame 0 (a ring drawing, dots gathering); no black frame | the ring and dots of `logo-outro`, or a drawn `arc` / `circle` | the ring stroke of [Logo outro](../programmatic/recipes.md#logo-outro) drawing from the first frame (`lo-ring`, 1 s) |
| Reveal | 1.2-1.8 | the mark lands in 0.4-0.6 s with an overshoot, then settles | `logo-outro` (`text` the wordmark), `pop-overshoot` on a raw wordmark | the wordmark of [Logo outro](../programmatic/recipes.md#logo-outro) popping on the bouncy curve at 1.2 s (`lo-mark`) |
| Hold | 1.8-4 | still and readable for at least 1.5 s; the tagline rises 0.75 s after the beat starts | a raw tagline line below the ring (never the component's `sub`, see Tagline) | the tagline of [Logo outro](../programmatic/recipes.md#logo-outro) rising in the caption band under the ring (`lo-tag`); nothing exits |

## Rules

- The mark is the hero: 30-40% of the frame width, centred (a lone logo may centre). Wordmark by the component, tagline in the
  caption band in `$ink`, one accent ring or underline drawing in 0.5-0.8 s after the mark lands.
- One sound at the reveal frame, gain 0.3-0.4 (`impact` or `chime`), or none, bound to the wordmark part with `sfx.on`
  (`<id>-wordmark`, event `arrive`). Nothing else.
- No glow past 20% intensity, no second effect on the mark, no glitch unless the brand is a glitch brand, no exit (the piece ends on
  the hold), no text under 30 px at 1080 wide.
- Palette and fonts from the brand if given (`themes.md`, brand colour recipe), otherwise the taste's; the motion block is the taste's.
- As an end card on a longer piece: same beat, 3 s hold, plus the one call to action.

## Tagline (leave the component's `sub` empty)

The component's tagline is 40 px, `muted`, at y 0.52, inside the accent ring: small, faint, overlapped. Write it as a raw text
sibling of the `logo-outro` (after it in the array, its own `at`, so polish does not stagger it): `$ink`, size 68 landscape or 38 at
1080 wide, `x` 0.5, `y = 0.46 + 0.675 x W_mark / H + 0.05` where `W_mark = max(120, 58 x letters)` px (4 letters on a 1080 high
stage: 0.66), `at` = the beat start + 0.75 s (calm 1.0 s) but no later than `beat end - (0.3 + words / 3.5)` (the reading time), `duration` reaching the end of the beat, opacity 0 to 1 in 0.4 s and a
y rise of 0.03, plus an opacity key at the end so polish adds no exit. The ring expands to 1.5x while it fades; that is why the
radius in the formula is `0.675 x W_mark`. The snippet follows (dark-glass motion block).

```json
{
  "format": "elah-input", "version": 1, "title": "Logo sting",
  "source": { "kind": "spec", "spec": {
    "version": 1, "title": "Logo sting", "format": { "width": 1080, "height": 1080, "fps": 30 }, "duration": 4,
    "background": "$bg", "motion": { "energy": "calm", "camera": true, "ambient": "orbs", "transition": "crossfade" },
    "design": {
      "colors": [ { "name": "bg", "value": "#0b0f14" }, { "name": "ink", "value": "#f4f6f8" }, { "name": "muted", "value": "#8a94a3" },
        { "name": "accent", "value": "#5eead4" }, { "name": "accentSoft", "value": "#134e4a" }, { "name": "surface", "value": "#151b24" } ],
      "fonts": [ { "role": "sans", "font": "inter" }, { "role": "display", "font": "space-grotesk" } ]
    },
    "elements": [
      { "id": "mark", "kind": "component", "component": "logo-outro", "at": 0, "duration": 4, "text": "Kora" },
      { "id": "mark-tag", "kind": "text", "at": 1, "duration": 3, "text": "Made to last", "font": "$sans", "size": 38, "color": "$ink",
        "align": "center", "maxWidth": 800, "x": 0.5, "y": 0.66, "letterSpacing": 2,
        "keys": [ { "channel": "opacity", "at": 0, "value": 0 }, { "channel": "opacity", "at": 0.4, "value": 1, "curve": "cubic-out" },
          { "channel": "opacity", "at": 3, "value": 1 }, { "channel": "y", "at": 0, "value": 0.69 }, { "channel": "y", "at": 0.5, "value": 0.66, "curve": "spring:snappy" } ] }
    ],
    "sfx": [ { "cue": "impact", "gain": 0.35, "on": { "element": "mark-wordmark", "event": "arrive", "offset": 0.1 } } ]
  } }
}
```
