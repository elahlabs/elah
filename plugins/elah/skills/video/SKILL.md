---
name: video
description: Make a video, motion graphic, explainer, title card or social clip with Elah. Claude writes the video as data (a VideoSpec, or one HTML + CSS page with real CSS animations), validates it, and publishes an Elah artifact where the user can preview it, edit it, and export an MP4. Use when the user asks to make, animate or draft a video or motion graphic.
argument-hint: "[what the video is about, length, format, style]"
allowed-tools: Bash(node *validate.mjs *) Bash(node *stage.mjs *)
---

# Make a video with Elah

The user wants: $ARGUMENTS

If that is empty, ask once what the video is about and for whom. Otherwise do not ask anything: a one-line brief is enough.
`reference/director.md` fills in the length, shape, format, taste and palette, and you say what you picked in one line.

Elah renders in the viewer's browser. This plugin never renders an MP4 itself: the MP4 is exported by the user from the
artifact (Export MP4). Never say the plugin rendered, exported or saved a video file.

## 1. Direct the video

**Start by reading `${CLAUDE_PLUGIN_ROOT}/reference/director.md`** and follow it: it turns the brief into defaults (length, shape,
palette), picks a format and a taste, and gives the beat sheet, spec-writing and review procedure. It tells you which of the small
files under `reference/formats/`, `reference/taste/` and `reference/craft/` to read for this brief (not all of them).

Write the beat sheet (one line per beat, with seconds and the one hero of each) in your reply before the document.

The director's **Medium** row picks the route; say which in your one-line choice. Default to a **VideoSpec**. Choose a **page**
(one self-contained HTML + CSS page with real CSS animations, `source.kind: "page"`) when the brief says html, css, web or page, or
asks for a look a VideoSpec cannot draw (backdrop blur, blend modes, rich gradients, SVG illustration); a brief that needs sound or
supplied images and audio stays VideoSpec. Do not use the older `kind: "html"` subset scene.

- **VideoSpec:** read `${CLAUDE_PLUGIN_ROOT}/reference/authoring.md` for the input format, and run

  ```
  node "${CLAUDE_PLUGIN_ROOT}/scripts/validate.mjs" --vocabulary
  ```

  once to get the exact font, icon, preset, component and curve names. Use only names it prints.
- **Page:** read `${CLAUDE_PLUGIN_ROOT}/reference/page.md` and `reference/page/motion.md` instead (and `page/example.md` for a
  complete valid page). The fonts are the twelve bundled ids; there is no vocabulary to print.

## 2. Write and validate `elah-input.json`

Pick a work folder: the scratchpad directory if the system prompt names one, otherwise `.elah/<short-slug>/` under the
current directory. Create it. Write `elah-input.json` there (format in the authoring reference, or `page.md` for a page), then run

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/validate.mjs" --notes "<work folder>/elah-input.json"
```

Exit 0 means it compiles; the output is a one-line summary, any warnings, and `info` notes on what the engine's polish pass added
(a page has no polish pass: its warnings are the animation checks listed in `page.md`).
Exit 1 lists every error with its path (for example `source.spec.elements[3].enter: unknown motion preset "teleport-in"`). Fix
every error in the file and run it again.

**Self-review round (mandatory).** Once the file validates, read `${CLAUDE_PLUGIN_ROOT}/reference/craft/review.md` and run its
checklist against the validator output and the file; fix what it finds and validate again. This round is one of the validation
rounds, not an extra one: do at most 3 rounds in total (write, review, one more fix), and if errors remain after that, show the
user the remaining messages and stop instead of publishing a broken file. Warnings are fixed or kept on purpose; say which you kept
and why in your closing note.

## 3. Publish the artifact (if the Artifact tool is available)

Check whether the `Artifact` tool exists in this session. If it does:

1. Load the `artifact-capabilities` skill first if it is listed, because the page must declare the `downloads` capability
   (MP4 export hands the viewer a file to save). Also load `artifact-design` if listed and the Artifact tool asks for it.
2. Stage the page into the work folder:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/stage.mjs" "<work folder>"
   ```
   It copies the Elah page and engine next to your input and prints JSON with `file_path` (the page) and `files` (every other
   engine file, published path to local path). If it says the page is missing, go to step 4.
3. Call `Artifact` to publish:
   - `file_path`: the printed `file_path` (the work folder's `index.html`).
   - `files`: the printed `files` map, plus `"elah-input.json": "<work folder>/elah-input.json"`.
   - `capabilities`: declare `downloads` (use the exact config the `artifact-capabilities` skill gives for it).
   - `icon`: `"video"`.
   - `description`: one sentence about this video.
   Do not edit the page file; it is the same page for every video. Artifacts start private; do not share or change who can
   see it unless the user asks.
4. Tell the user, briefly, what they can do in the artifact: **Preview** (play and scrub), **Edit** (change text, timing,
   keyframes and curves), **Export MP4** (renders in their browser and saves a file), **Open in Elah** (continue in the full
   editor). Say that if the page lists problems, they can paste that panel back here and you will fix the input and republish
   with the same file path. Give the artifact link.

## 4. If the Artifact tool is not available

Write the validated input to the current directory as `<slug>.elah-input.json` and tell the user where it is. Say plainly that
previewing, editing and exporting need the Elah artifact page, which needs a Claude Code account with artifacts enabled, and
that no web import for this file exists yet; do not make up a URL or steps for one. The validated file is still a complete
description of the video, so they can keep it.

## Rules

- Never claim a video was rendered or exported by this plugin. Export happens in the artifact.
- Do not call any paid or external service, and do not invent image, audio or font files. Use only what the vocabulary lists (a page: only the twelve bundled font ids, no network, no scripts).
- Never skip validation. Never publish an input the validator rejected.
- Keep the user's wording (names, numbers, claims) exactly; do not invent statistics or testimonials.
