# Format: recap (meeting notes, minutes, a changelog, a roundup)

15-45 s (default 25). The user pastes raw material — meeting notes, minutes, a transcript, release notes, a week's shipped
list — and the video gives it a spine: what it was about, the few things that matter, what happens next. It is a summary with
motion, not a slide deck read aloud.

## Reading the material first

Before any beat, pull out of the paste, in this order, and show the list in your reply so the user can correct it:

1. **The subject** — what the meeting, release or week was about, in up to 8 words.
2. **3 to 5 items** — decisions, changes or shipped things, one short clause each, starting with a verb or a result ("Moved
   launch to March", "Shipped the export queue"). Five is the ceiling; more than five means you have not chosen.
3. **Any figure the material states** — a date, a count, a percentage. Never a figure it does not state.
4. **The next step** — one owner-and-action line if the material names one, otherwise the closing line is the subject restated.

Cut everything else: side discussion, attendee lists, timestamps, chatter. If the paste has no items worth three beats, say so
and offer a title card instead of padding it.

## Beat table (25 s)

The last column is the programmatic video (the default medium); the column before it is the VideoSpec alternative.

| Beat | Seconds | Job | What fits (VideoSpec) | Programmatic recipe (`programmatic/recipes.md`) |
| --- | --- | --- | --- | --- |
| Title | 0-3 | the subject and its date, on screen at frame 0 | `kinetic-title`, `typewriter-line`, raw hero text | [Kinetic title](../programmatic/recipes.md#kinetic-title), [Typewriter line](../programmatic/recipes.md#typewriter-line) |
| Frame | 3-6 | one line saying why it mattered, or the count of items ("Four decisions") | `big-number` with a label, `circled-phrase` | [Count-up](../programmatic/recipes.md#count-up-digit-reel) on the count, [Circled phrase](../programmatic/recipes.md#circled-phrase) |
| Items | 6-20 (3-5 beats of 3-4.5) | one item per beat: a number badge, the clause as hero, an owner or date beneath it | `checklist` (one beat for all of them when the length is short), `badge-callouts`, raw numbered badge + line | [Steps that swap](../programmatic/recipes.md#steps-that-swap) (one ring and number morphing item to item), [Checklist](../programmatic/recipes.md#checklist) when they share one beat |
| Numbers | optional, 4 s | only if the material stated figures: the one that matters | `stat-bars`, `big-number` | [Stat bars](../programmatic/recipes.md#stat-bars), [Count-up](../programmatic/recipes.md#count-up-digit-reel) |
| Next | 20-25 | the next step, owner and date, held 2 s | raw hero line, `quote-card` for a direct quote, `logo-outro` if the team has a name | a hero line, [Quote card](../programmatic/recipes.md#quote-card), [Logo outro](../programmatic/recipes.md#logo-outro) |

## Rules

- One item per beat and one clause per item. Never a bulleted list of five lines on one frame; the list is the timeline.
- Keep the user's wording for each item. Shorten by cutting words, never by rewriting what was decided. Do not soften, grade
  or editorialise ("a great result") — the material's own tone only.
- Number the items on screen (1/4, 2/4 ...) so a viewer knows where they are. The badge is the only element that persists
  across the item beats; everything else swaps.
- Names of people: only initials or first names, and only when the material names an owner for that item. Never invent an
  owner, a date or a decision that is not in the paste.
- No figure the material did not state, and no chart for fewer than three values — a single figure is a count-up, not a bar.
- Pace is brisk but readable: 3-4.5 s per item, each held 0.5 s + 0.3 s per word. More than five items means a longer video or
  a harder cut, never faster beats.
- Vary the arrival between item beats but keep ONE hand-off family; the badge morphs, the clause arrives differently each time.
- Taste, palette, ambient and energy come from `director.md` and the taste file. With no signal in the material, a recap is
  Clean Sheet at standard energy — it is read, not performed.

## Cuts for other lengths

15 s: title, three items in one `checklist` beat, next step — 3 scenes. 45 s: give each item its own Numbers sub-beat where the
material has a figure for it, and open with a 5 s Frame beat.

## Shape

Landscape by default. Vertical when the brief says social, reel, story, Shorts, TikTok or phone — then read
`social-vertical.md` too and stack each item inside the safe bands, one per beat (never a two-column item grid).
