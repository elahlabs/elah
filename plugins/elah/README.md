# Elah plugin for Claude Code

Make a video or motion graphic from Claude Code. Claude writes it as data, the plugin validates it with the Elah engine, and
an Elah artifact opens it for preview, editing and MP4 export in the browser.

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
| `video` | `/elah:video a 20 second explainer on how DNS works` | Plans the beats, writes a VideoSpec (or an HTML/CSS scene), validates it, publishes the artifact. |
| `promo` | `/elah:promo launch video for our AI notes app, 20 s, dark, punchy` | Same flow with a fixed 15 to 30 second launch structure: hook, problem, product, three features, call to action. |

In the artifact: Preview, Edit (Animate tab, keyframes, curves), Export MP4 (rendered in your browser), Open in Elah.
The plugin never renders a video itself. Without the Artifact tool the skills write `<name>.elah-input.json` and say so.

## What is inside

```
.claude-plugin/plugin.json      manifest (name "elah")
skills/video/SKILL.md           the video skill
skills/promo/SKILL.md           the promo skill
reference/authoring.md          input format, VideoSpec and HTML-subset cheat sheet (read by both skills)
scripts/validate.mjs            GENERATED validator bundle, plain Node: node validate.mjs <elah-input.json> | --vocabulary | --json
scripts/stage.mjs               copies assets/artifact into a work folder and prints the Artifact `files` map
scripts/validate.test.mjs       node --test file; scripts/fixtures/ its inputs
src/validate.src.mjs            validator source
build.mjs                       builds scripts/validate.mjs and copies artifact/dist into assets/artifact
assets/artifact/                GENERATED copy of artifact/dist (the page, engine bundle, workers, fonts, MANIFEST.json)
```

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

`0` valid (one-line summary, warnings listed), `1` invalid or unreadable (every error with its path), `2` usage error.
