# Elah plugin for Claude Code

Make a video or motion graphic from Claude Code. Claude writes a programmatic video (HTML + CSS motion), the plugin validates it
with the Elah engine, and an Elah artifact opens it for preview, editing and MP4 export in the browser.

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
| `video` | `/elah:video a 20 second explainer on how DNS works` | Plans the beats, writes a programmatic video (HTML + CSS motion; a VideoSpec of Elah components when the brief needs sound or supplied images and audio), validates it, publishes the artifact. |
| `promo` | `/elah:promo launch video for our AI notes app, 20 s, dark, punchy` | Same flow with a fixed 15 to 30 second launch structure: hook, problem, product, three features, call to action. |

Both start from a short brief. Claude reads `reference/director.md`, picks length, shape, format, taste and palette for you (and says so), writes a beat sheet, builds the video, then reviews it against the validator before publishing. Overrides go in the brief: `vertical`, `30s`, `style: editorial`, `format: data-story`, `calm` or `bold`, `medium: spec`.

Medium: a **programmatic video** by default (HTML + CSS motion: one self-contained document with real CSS animations, no scripts, no network, the twelve bundled fonts; it draws backdrop blur, blend modes, rich gradients and SVG art, and a short graphic is programmatic motion). Claude writes a **VideoSpec** (Elah components, presets, sound, supplied images and audio) instead only when the brief needs a soundtrack or sound effects, supplied image or audio URLs, or asks for Elah components, and says why in one line. Say `medium: programmatic` or `medium: spec` to force either. The validator checks a programmatic video at string level (refusals name the substitute; warnings cover animation durations, fill modes, missing `@keyframes`, scenes); the artifact does the DOM-level checks and converts the animations to native keyframes when you press Edit.

In the artifact: Preview, Edit (Animate tab, keyframes, curves), Export MP4 (rendered in your browser), Open in Elah.
The plugin never renders a video itself. Without the Artifact tool the skills write `<name>.elah-input.json` and say so.

## What is inside

```
.claude-plugin/plugin.json      manifest (name "elah")
skills/video/SKILL.md           the video skill
skills/promo/SKILL.md           the promo skill
reference/authoring.md          input format, VideoSpec and HTML-subset cheat sheet (the VideoSpec route)
reference/director.md           the managing layer: brief -> defaults, format, taste, beat sheet, build, review (read first)
reference/programmatic.md       the programmatic video route (the default): `kind: "page"` input, time rules, safe stage, fonts, what Edit converts
reference/programmatic/         motion.md (curves, durations, stagger, transitions as CSS), example.md (a validated 6 s two-scene video), recipes.md (the formats' beats as HTML + CSS, validated together)
reference/components.md         the 17 motion components and 6 systems, and the lint notes each one carries
reference/themes.md             eleven ready palettes (all six tokens) and bundled font pairs
reference/craft/                motion.md, type-and-layout.md, generators.md, review.md
reference/formats/              launch, explainer, data-story, kinetic-type, logo-reveal, social-vertical beat tables
reference/taste/                floor.md plus dark-glass, editorial, brutalist, minimal
THIRD_PARTY_NOTICES.md          the open-source guidance the craft files were adapted from
scripts/validate.mjs            GENERATED validator bundle, plain Node: node validate.mjs <elah-input.json> [--json] [--notes] | --vocabulary
scripts/stage.mjs               copies assets/artifact into a work folder and prints the Artifact `files` map
scripts/validate.test.mjs       node --test file; scripts/fixtures/ its inputs
src/validate.src.mjs            validator source
build.mjs                       builds scripts/validate.mjs and copies artifact/dist into assets/artifact
assets/artifact/                GENERATED copy of artifact/dist (the page, engine bundle, workers, fonts, MANIFEST.json)
```

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
