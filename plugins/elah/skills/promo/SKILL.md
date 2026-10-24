---
name: promo
description: Make a 15 to 30 second product launch promo with Elah (hook, problem, product, three features, call to action). Claude writes it, validates it, and publishes an Elah artifact to preview, edit and export as MP4. Use when the user asks for a launch video, product promo, app teaser or ad.
argument-hint: "[product name, one-line pitch, brand colour, length]"
allowed-tools: Bash(node *validate.mjs *) Bash(node *stage.mjs *)
---

# Make a product launch promo with Elah

The user wants: $ARGUMENTS

This is the `video` skill's flow with a fixed story shape. Elah renders in the viewer's browser; this plugin never renders an
MP4 itself, and you must never say it did. The MP4 is exported from the artifact.

## 1. Collect four inputs

Ask once, in one message, only for what is missing. Offer a default for each so the user can just say "go":

1. **Product name** (required, no default).
2. **One-line pitch** (required: what it does and for whom).
3. **Brand colour** (default: a deep dark background with one bright accent; ask for a hex if they have one).
4. **Length**: 15, 20, 25 or 30 seconds (default 20) and shape: landscape 1920x1080, vertical 1080x1920 or square 1080x1080 (default landscape).

If the user gave three features, use them. Otherwise propose three short benefit-style features derived only from the pitch
and let the user correct them after seeing the result; never invent numbers, customers, awards or testimonials.

## 2. Structure

Time-box the beats to the chosen length (the numbers below are for 20 s; scale the middle beats):

| Beat | Seconds | Content |
| --- | --- | --- |
| Hook | 0 to 2.5 | one short line that stops the scroll, large type |
| Problem | 2.5 to 6 | the pain in one sentence, with a simple visual (icons or shapes) |
| Product | 6 to 9 | product name large, with the pitch under it |
| Feature 1, 2, 3 | 9 to 17 | about 2.5 s each: an icon, a 2 to 4 word title, one supporting line |
| CTA | 17 to 20 | product name, call to action ("Try it today", or the user's own), a URL only if the user gave one |

Design rules: one accent colour on a dark or very light background; at most two fonts from the vocabulary (a display face for
headlines, `inter` for body); text no smaller than 7% of the stage height for headlines and 3.5% for body; keep 8% safe
margins; change the entrance preset between beats; end with a held frame of at least 1 second so the call to action can be read.

## 3. Author, validate, publish

Follow the `video` skill from its step 1 on, with the beat table above as the plan:

1. Read `${CLAUDE_PLUGIN_ROOT}/reference/authoring.md` and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/validate.mjs" --vocabulary`; use only names it prints. Default to a VideoSpec.
2. Write `elah-input.json` (title = the product name plus "launch") in a work folder (the scratchpad directory if the system prompt names one, otherwise `.elah/<slug>/` in the current directory) and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/validate.mjs" "<work folder>/elah-input.json"`. Fix every error and re-run, at most 3 rounds, then show the remaining messages instead of publishing.
3. If the `Artifact` tool is available: load the `artifact-capabilities` skill first if listed (declare `downloads`), run `node "${CLAUDE_PLUGIN_ROOT}/scripts/stage.mjs" "<work folder>"`, then publish with `file_path` = the printed page, `files` = the printed map plus `"elah-input.json"`, `capabilities` declaring `downloads`, `icon: "video"`, and a one-sentence `description`. Tell the user they can Preview, Edit (text, timing, keyframes, curves), Export MP4 and Open in Elah, and that they can paste any problems the page lists back here.
4. If the Artifact tool is not available: write `<product-slug>.elah-input.json` to the current directory and say previewing and exporting need the Elah artifact page; do not invent a web import.

After publishing, offer two quick follow-ups (a vertical cut, or a different accent colour) and republish to the same artifact
with the same file path when the user picks one.
