# Format: social and vertical (9:16, also 1:1 feed)

Applies on top of any other format whenever the brief says social, reel, story, Short, TikTok, phone, vertical or square. Stage
1080x1920 (square 1080x1080), 30 fps, 9-30 s (default 15).

## Frame and safe zones (1080x1920)

- Words and the product between y 0.10 and 0.72 (top 168 px belongs to the platform bar; the bottom 20% to captions, handle and
  buttons). Below y 0.72 only decoration, or the call to action on the last beat. Keep 6% off the right edge (action buttons), 8% on
  the left; every text box inside the 6% margins the lint checks.
- Square 1080x1080: the same bands, hero at y 0.40, nothing below y 0.82.
- Type is the 1080 band table: headline 96-140, support 48-64, caption 30-38. Never smaller than 30 px; cut words instead of shrinking.
  A claim is at most 5 English words per line.

## Pace and beats (15 s)

| Beat | Seconds | Job |
| --- | --- | --- |
| Hook | 0-2 | frame 0 is the thumbnail: a bold line or a result, never the logo or a black frame; the question or the change inside the first beat |
| Payoff A | 2-6 | the main idea, one phrase as hero |
| Payoff B | 6-10 | the proof or the second idea (number, quote or result only if the user gave one) |
| Turn | 10-12 | a faster or louder beat, the one wow moment |
| Call to action | 12-15 | one action, held 2 s; a loop back to frame 1 only as a deliberate choice |

- A new beat every 2-4 s (1.5-2.5 s for energetic pieces); an arrival every 0.5-1 s inside a beat. Faster than landscape.
- Assume sound is off: the picture carries the hook. With a voice-over (the user's audio URL only) put short on-screen lines, not the
  transcript word for word.
- Centre one subject and stack vertically; rebuild any side-by-side idea as a sequence of beats. Components are native here
  (VideoSpec). In a programmatic video the recipes in `programmatic/recipes.md` are written for 1920x1080: keep their animation
  lines and rebuild the positions as one stack inside y 190-1380 with the vertical bands.
- Taste, palette and motion block come from `director.md` and the taste file (a brief with no taste signal gets the underlying
  format's default). This file adds shape, safe zones and beat pace only.
