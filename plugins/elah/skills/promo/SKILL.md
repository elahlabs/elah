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

**Start by reading `${CLAUDE_PLUGIN_ROOT}/reference/director.md`**, with `format: launch` (the beat table is in
`${CLAUDE_PLUGIN_ROOT}/reference/formats/launch.md`). Follow the director for defaults, taste, palette, beat sheet and review.

## 1. Fill in the four inputs (do not interrogate)

1. **Product name.** Required. If the brief has none and no product can be inferred, ask once, in one short message; that is the only
   question you may ask.
2. **One-line pitch** (what it does and for whom). If missing, derive a plain one from the name and context, say that you did, and let
   the user correct it after seeing the result.
3. **Brand colour.** Default: the palette of the taste `director.md` picks (the only place a taste is chosen). A hex in the brief
   becomes the `accent`; see `reference/themes.md`.
4. **Length and shape.** Default 20 s landscape 1920x1080. 15, 20, 25 or 30 s; vertical 1080x1920 when the brief says social, reel,
   story or phone; square 1080x1080 for a feed.

If the user gave three features, use them. Otherwise write three short benefit-style features derived only from the pitch and say they
are proposed; never invent numbers, customers, awards or testimonials. Say what you picked in one line, then build.

## 2. Structure

Use the beat table in `formats/launch.md` (hook, problem, product, features, optional proof, call to action), time-boxed to the
chosen length, with one hero per beat and the product named in the first third. End with a held call-to-action beat of at least 1.5 s
(2-3 s is better). Components and presets for each beat are in that file; type sizes, margins and the accent budget are in
`craft/type-and-layout.md`.

## 3. Author, validate, review, publish

Follow the `video` skill from its step 1 on, with the beat table above as the plan:

1. Take the medium from the director's Medium row: default VideoSpec, a **page** (`source.kind: "page"`, one HTML + CSS page) when the brief says html, css, web or page or wants backdrop blur, blend modes, rich gradients or SVG illustration. VideoSpec: read `${CLAUDE_PLUGIN_ROOT}/reference/authoring.md` and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/validate.mjs" --vocabulary`; use only names it prints. Page: read `${CLAUDE_PLUGIN_ROOT}/reference/page.md` and `reference/page/motion.md` instead; the launch beat table still sets the scenes (one `data-scene` per beat).
2. Write `elah-input.json` (title = the product name plus "launch") in a work folder (the scratchpad directory if the system prompt names one, otherwise `.elah/<slug>/` in the current directory) and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/validate.mjs" --notes "<work folder>/elah-input.json"`. Fix every error and re-run.
3. **Self-review round (mandatory).** Read `${CLAUDE_PLUGIN_ROOT}/reference/craft/review.md` and run it against the validator output and the file; fix what it finds and validate again. It counts inside the validation rounds: at most 3 in total, then show the remaining messages instead of publishing.
4. If the `Artifact` tool is available: load the `artifact-capabilities` skill first if listed (declare `downloads`), run `node "${CLAUDE_PLUGIN_ROOT}/scripts/stage.mjs" "<work folder>"`, then publish with `file_path` = the printed page, `files` = the printed map plus `"elah-input.json"`, `capabilities` declaring `downloads`, `icon: "video"`, and a one-sentence `description`. Tell the user they can Preview, Edit (text, timing, keyframes, curves), Export MP4 and Open in Elah, and that they can paste any problems the page lists back here.
5. If the Artifact tool is not available: write `<product-slug>.elah-input.json` to the current directory and say previewing and exporting need the Elah artifact page; do not invent a web import.

After publishing, offer two quick follow-ups (a vertical cut, or a different accent colour) and republish to the same artifact
with the same file path when the user picks one.
