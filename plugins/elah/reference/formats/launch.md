# Format: product launch (promo, teaser, app ad)

15-30 s. One idea for the viewer to keep: what the product does and for whom. One real thing shown from hook to end card. Beats are
top-level elements that touch (end == next start), 2-4 s each, one hero per beat.

## Beat table (seconds; scale the middle beats to the length)

The last column is the programmatic video (the default medium); the column before it is the VideoSpec alternative.

| Beat | 15 s | 20 s | 30 s | Job | What fits (VideoSpec) | Programmatic recipe (`programmatic/recipes.md`) |
| --- | --- | --- | --- | --- | --- | --- |
| Hook | 0-2.5 | 0-2.5 | 0-3 | stop the scroll; frame 0 already has the line; the pain or the claim in up to 6 words | raw hero text (`blur-in`, reveal `word-pop`), `kinetic-title` with `emphasis`, `word-hits` for a bold piece | [Kinetic title](../programmatic/recipes.md#kinetic-title) (blur-in headline, one emphasis word); [Word hits](../programmatic/recipes.md#word-hits) for a bold piece |
| Problem | 2.5-5 | 2.5-6 | 3-8 | the old way failing, one sentence plus a simple visual | `circled-phrase` (no `sub`; the beat is the component plus a top-band label, never a raw line in its box), `comparison` (muted left only), `chip-cloud` of the pains, `clock-sweep` for time | [Circled phrase](../programmatic/recipes.md#circled-phrase) (SVG ellipse drawn round the phrase, a top-band label); [Comparison](../programmatic/recipes.md#comparison) (the muted left card alone); [Chip cloud](../programmatic/recipes.md#chip-cloud) of the pains; [Clock sweep](../programmatic/recipes.md#clock-sweep) for time |
| Product | 5-8 | 6-9 | 8-12 | the name large, the pitch under it, named by 25-35% of the way in | raw hero text + support line, `kinetic-title`, a `section-break` into it | the hero line + support of `programmatic/example.md`; [Kinetic title](../programmatic/recipes.md#kinetic-title); a [Section break](../programmatic/recipes.md#section-break) into it |
| Features | 8-12 (one beat, 3 items) | 9-17 (3 beats of about 2.7) | 12-22 (3 beats of about 3.3) | 2-3 short benefits as verbs: icon, 2-4 word title, one supporting line | `icon-row` (highlight one), `badge-callouts`, `checklist`, `stat-ring` / `big-number` if the user gave a number | [Icon row](../programmatic/recipes.md#icon-row) (inline SVG icons, staggered rise, highlight one); [Badge callouts](../programmatic/recipes.md#badge-callouts); [Checklist](../programmatic/recipes.md#checklist); [Stat ring](../programmatic/recipes.md#stat-ring) / [Count-up](../programmatic/recipes.md#count-up-digit-reel) if the user gave a number |
| Proof | none | none | 22-26 | only a number, rating or quote the user supplied | `big-number`, `stat-ring`, `quote-card`, `testimonial-cards` | [Count-up](../programmatic/recipes.md#count-up-digit-reel), [Stat ring](../programmatic/recipes.md#stat-ring), [Quote card](../programmatic/recipes.md#quote-card), [Testimonial cards](../programmatic/recipes.md#testimonial-cards) |
| Call to action | 12-15 | 17-20 | 26-30 | the product name, one action, a URL only if given; held 2-3 s | `logo-outro` (`text` the name, `sub` left empty) plus the action as a raw line below the ring (position, size and timing all in `components.md`, "logo-outro tagline"; no other file needed) | [Logo outro](../programmatic/recipes.md#logo-outro) (wordmark in type, ring stroke drawn round it, tagline in the caption band below the ring) |

## Rules

- Open on the problem or the claim, never on the logo, a black frame, or "Introducing" / "Meet". The mark appears once, with weight,
  in the closing beat.
- Name the product in the first third. Copy comes from the user: their product name, pitch, numbers, claims. With no numbers there is
  no stat beat; do not make one up. Three features at most, each starting with a verb or a result ("Capture in one tap").
- Vary the arrival between beats (`blur-in`, `slide-in-up`, `pop-in`, a component) and keep ONE hand-off family (VideoSpec:
  `motion.transition`). The scene count follows the table: 5 scenes at 15 s (one features scene), 7 at 20 s, 8 at 30 s; every seam
  uses that one family.
- The name appears twice, with different jobs: the Product beat is the name plus the pitch (and a drawn idea of the product); the
  Call to action is the mark plus the action. Never repeat the pitch line on the end card.
- Show, not tell: where the product has an interface, draw its idea with shapes (a card, a toggle, a cursor) rather than describing
  it; never invent a screen, a dashboard or a logo file. No `image` unless the user supplied a URL.
- Hold: every line 0.5 s + 0.3 s per word; the product name and call to action at least 1.5 s each; the end card 2-3 s.
- Stat or proof beats: count up over 1.2-1.6 s then hold at least 1.5 s.
- Sound: a hit on the hook landing, a tick per feature, a chime on the end card, gain 0.25-0.35; none on plain cuts. Sound
  effects do not change the medium (a programmatic video carries them as `data-sfx`); only a soundtrack, a voice-over or supplied
  audio makes a promo a VideoSpec (`director.md`, Medium row; say why in one line).

## Shape

Taste, palette and motion come from `director.md` and the taste file, not from this format. Vertical when the brief says social, reel,
story, Shorts, TikTok or phone; otherwise landscape. In vertical use components freely; in landscape follow `components.md` (raw hero
lines, components as centrepieces, each component's region kept clear).

## Cuts for other lengths

Shorter than 15 s: drop Problem and fold the pain into the hook. 45 s and over is an explainer; read `explainer.md` instead.
