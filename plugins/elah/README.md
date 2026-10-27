# Elah plugin for Claude Code

AI drafts your video, you edit it frame by frame, all in your browser, then export an MP4. Ask Claude Code for a video or motion
graphic; Claude writes it, the plugin checks it with the Elah engine, and an Elah artifact opens it for preview, keyframe editing
and MP4 export.

Star us on GitHub: https://github.com/elahlabs/elah

This is an unofficial, open-source plugin for Claude Code from the Elah project. It is not made or endorsed by Anthropic.

## Install

In Claude Code:

```
/plugin marketplace add elahlabs/elah
/plugin install elah@elah
```

(or in a shell: `claude plugin marketplace add elahlabs/elah` then `claude plugin install elah@elah`). Run `/reload-plugins`
if the skills do not show up.

## Use

| Skill | Run | What it does |
| --- | --- | --- |
| `motion` | `/elah:motion a 20 second explainer on how DNS works` | Every kind of video: launch, explainer, data story, recap, words in motion, logo sting, vertical social. Asks one round of questions, plans the beats, writes it, validates it, publishes the artifact. |
| `saas` | `/elah:saas a podcast clip editor for agencies` | Scaffolds your own video editor app on the `@elah/*` packages: a real Vite or Next.js project in a folder you own, with your branding and browser-side MP4 export. |
| `revise` | `/elah:revise make it 10 seconds and Poster Shout` | Reopens the last video and changes it as asked (shorter, another look, new wording, vertical), keeping your edits, and updates the same artifact link. |
| `brand` | `/elah:brand #1e90ff` (or a logo file, or a website URL) | Saves a brand kit in `.elah/brand.json` (palette, two bundled fonts, look, and the logo you supply) that every later video in that folder uses unless your brief says otherwise. |

`/elah:motion` takes a one-line brief or a paste of raw material — meeting notes, a changelog, a list of figures, a pitch. It
asks **one** round of questions (look and colours, length and shape, sometimes the angle, with sound or silent), each with a
recommended answer, then reads `reference/director.md`, writes a beat sheet, builds the video and reviews it against the
validator before publishing. Say "just build it" to skip the questions, or put the answers in the brief: `vertical`, `30s`,
`look: Gallery Serif`, `format: data story`, `calm`, `bold`. Ask for "options" (or "directions", "treatments") and Claude
offers three one-line treatments instead and builds the one you pick.

The four looks are Midnight Glass, Gallery Serif, Poster Shout and Clean Sheet; the formats are Launch, Explainer, Data story,
Recap, Words in motion, Logo sting and Social. The old words still work: `style:`, `taste:`, the old ids (`dark-glass`,
`editorial`, `brutalist`, `minimal`), "kinetic type" and "logo reveal". `/elah:video`, `/elah:promo` and `/elah:social` were
folded into `/elah:motion`; their briefs work there unchanged.

In the artifact: Preview, Edit (Animate tab, keyframes, curves), Export MP4 (rendered in your browser), Download project (an `.elah.json` file that opens in Elah Creator), and Try Elah (opens Elah Creator, where captions, background removal, voice-over, image and video generation, the AI Assistant and advanced editing live).
While building, the plugin's `sfx-search.mjs` may contact api.openverse.org and cdn.freesound.org to fetch a CC0 sound the bundled pack lacks; the artifact itself never reaches the network.
The plugin never renders a video itself. Without the Artifact tool the skills write `<name>.elah-input.json` and say so.

## What is inside

```
.claude-plugin/plugin.json      manifest (name "elah")
skills/motion/SKILL.md          every kind of video: asks one question round, then builds
skills/saas/SKILL.md            scaffold your own editor app on the @elah/* packages
skills/revise/SKILL.md          change the last video and update the same artifact link
skills/brand/SKILL.md           save a brand kit (.elah/brand.json) from a hex, a logo or a website
reference/brand.md              the brand.json shape and how the director applies it
reference/authoring.md          input format, VideoSpec and HTML-subset cheat sheet (the VideoSpec route)
reference/director.md           the managing layer: brief -> defaults, format, look, beat sheet, build, review (read first)
reference/programmatic.md       the programmatic video route (the default): `kind: "page"` input, time rules, safe stage, fonts, what Edit converts
reference/programmatic/         motion.md (curves, durations, stagger, transitions as CSS), example.md (a validated 6 s two-scene video), recipes.md (the formats' beats as HTML + CSS, validated together)
reference/components.md         the 17 motion components and 6 systems, and the lint notes each one carries
reference/themes.md             eleven ready palettes (all six tokens) and bundled font pairs
reference/craft/                motion.md, type-and-layout.md, generators.md, review.md
reference/formats/              launch, explainer, data-story, recap (notes and minutes), kinetic-type (Words in motion), logo-reveal (Logo sting), social-vertical beat tables
reference/saas.md               the @elah/* packages, the three stylesheets, app shape and traps (the saas skill)
reference/taste/                floor.md plus the four looks: dark-glass (Midnight Glass), editorial (Gallery Serif), brutalist (Poster Shout), minimal (Clean Sheet)
THIRD_PARTY_NOTICES.md          the open-source guidance the craft files were adapted from
scripts/validate.mjs            GENERATED validator bundle, plain Node: node validate.mjs <elah-input.json> [--json] [--notes] | --vocabulary
scripts/stage.mjs               copies assets/artifact into a work folder and prints the Artifact `files` map
scripts/sfx-search.mjs          searches Openverse for a CC0 sound the pack lacks and saves it to assets/sfx/ with credits
scripts/validate.test.mjs       node --test file; scripts/fixtures/ its inputs
src/validate.src.mjs            validator source
build.mjs                       builds scripts/validate.mjs and copies artifact/dist into assets/artifact
assets/artifact/                GENERATED copy of artifact/dist (the page, engine bundle, workers, fonts, MANIFEST.json)
```

## Technical: the medium (expert override)

Plain briefs never need this. A **programmatic video** is the default (HTML + CSS motion: one self-contained document with real CSS animations, no scripts, no network, the twelve bundled fonts; it draws backdrop blur, blend modes, rich gradients and SVG art, and a short graphic is programmatic motion). Claude writes a **VideoSpec** (Elah components, presets, sound, supplied images and audio) instead only when the brief needs a soundtrack or sound effects, supplied image or audio URLs, or asks for Elah components, and says what was built, in plain words. An expert can write `medium: programmatic` or `medium: spec` in the brief to force either. The validator checks a programmatic video at string level (refusals name the substitute; warnings cover animation durations, fill modes, missing `@keyframes`, scenes); the artifact does the DOM-level checks and converts the animations to native keyframes when you press Edit.

## Craft sources

The craft layer under `reference/` is written in medium-neutral words, then shown in CSS (programmatic video) and in Elah's VideoSpec
vocabulary, and agrees with the engine's own lint thresholds (`packages/core/src/spec/polish.ts`). It adapts, in our own words, open-source motion-design guidance from HeyGen HyperFrames
(Apache-2.0), LottieFiles motion-design-skill (MIT), iart-ai motion-design-skills (MIT), Anthropic's theme-factory (Apache-2.0) and
Leonxlnx taste-skill (MIT). Licences, URLs and what was drawn from each are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Build (maintainers)

`scripts/validate.mjs` and `assets/artifact/` are generated and **committed**, so users can install straight from the
repository without building. After changing the engine's spec compiler, `artifact/`, or `src/validate.src.mjs`, run from the
repo root (no install needed; it uses the esbuild already in `node_modules`):

```
node plugins/elah/build.mjs
node --test "plugins/elah/scripts/*.test.mjs"
claude plugin validate ./plugins/elah
claude plugin validate .
```

Then commit the regenerated files. `build.mjs` needs `artifact/dist/MANIFEST.json` from `npm run build` in `artifact/`; without it,
only the validator is rebuilt.

## Validator exit codes

`0` valid (one-line summary, warnings listed; `--notes` adds what the engine's polish pass filled in), `1` invalid or unreadable (every error with its path), `2` usage error.
