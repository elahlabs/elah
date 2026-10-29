---
name: saas
description: Scaffold your own video editor app on the Elah libraries - a real Vite or Next.js project you run and deploy. Use when someone wants to build their own editor or video product.
argument-hint: "[what the product is for, e.g. a podcast clip editor for agencies]"
allowed-tools: AskUserQuestion Bash(npm view *) Bash(npm install*) Bash(npm run *)
---

# Build a video editor on Elah

The user wants: $ARGUMENTS

This makes a **real project in a folder on their machine**: an app that imports the published `@elah/*` packages and runs with
`npm run dev`. It is not an artifact and not a demo. Everything runs in the browser — no server, no account, no API key.

## 1. Ask one round of questions

Read `${CLAUDE_PLUGIN_ROOT}/reference/saas.md` first (packages, stylesheets, app shape, traps), then ask **one**
`AskUserQuestion` round, at most 4 questions, each option one short line, the recommendation first:

1. **Stack** — "Vite + React (Recommended)", "Next.js App Router", "Add it to the app I already have".
2. **How much editor** — "Full editor: preview, timeline, panels, export (Recommended)", "Timeline and preview only",
   "Player only, no editing".
3. **Look** — "Elah dark (Recommended)", "Light", "My brand colours" (then take the hex in the follow-up, or from
   `.elah/brand.json` if it exists — then that is the recommendation).
4. **What it is for** — only when `$ARGUMENTS` does not say. Their answer shapes the default tracks, the panel set and the
   README, so ask it as free text rather than offering guesses.

Skip any question the brief already answers. If they say "just scaffold it", take Vite + React, full editor, Elah dark.

## 2. Pick the folder and check it

Default to `./<slug>` under the current directory, where the slug comes from what the product is for. Say the path in one
line before creating anything. If the folder exists and is not empty, stop and ask; never write into a populated folder and
never overwrite a file you have not read.

For "add it to the app I already have": do not scaffold. Read their `package.json` and entry point, confirm the framework,
and add the dependencies, the three stylesheet imports and one editor route or component to what is there. Change nothing
else.

## 3. Resolve the real versions

```
npm view @elah/editor version
npm view lucide-react version
```

Pin `^<major.minor>` of what those print. Never copy a version out of the reference file or out of the Elah monorepo's own
`package.json` — the repository runs ahead of what is published, and a scaffold pinned to an unpublished version does not
install.

## 4. Write the project

Follow `reference/saas.md`. If the Elah repository is on disk, read the `examples/` app that matches the chosen stack first
and keep the scaffold close to it; it is the version that is known to run.

Write, at minimum:

- `package.json` — the resolved dependencies, `dev`, `build`, `typecheck` scripts.
- The entry file with all three stylesheets imported in order (`@elah/timeline/styles.css`, `@elah/editor/styles.css`,
  `@elah/editor/styles/tokens.css`), then the app's own CSS.
- One editor component: `EditorProvider` with the initial tracks for this product, the header (play/pause, undo/redo, zoom,
  Export), and whichever of `Preview`, `AssetPanel`, `ElementsPanel`, `Timeline` the chosen scope includes.
- The app's own CSS redefining the `--elah-*` tokens under `.elah-root` for the chosen look. Branding is tokens; do not fork
  a package to change a colour.
- `tsconfig.json`, and for Next.js a client-only page that loads the editor with `next/dynamic` and `ssr: false`.
- `README.md` — how to run it, that media stays in the browser, that MP4 export needs WebCodecs (Chrome, Edge, recent
  Safari), and that the packages are Apache-2.0.

Tailor the tracks and panels to what the product is for: a podcast clip editor opens with audio tracks on top, a social
cutter opens vertical, a slideshow tool may not want an audio lane at all. Do not ship the generic three-track demo when the
brief says what the product is.

## 5. Install, build, say what passed

```
npm install
npm run typecheck
npm run build
```

Run them in the project folder and paste the real result. If install or build fails, fix it and run again; if it still
fails, show the user the actual error and stop rather than claiming a working scaffold. If the user does not want an
install, say explicitly that nothing was installed or built, and that `npm install` is their next step.

Then tell them, in a few lines: the folder, the command to start it, what the app does today, and the two or three obvious
next things for their product (a save format with `serializeProject`, their own export preset, an extra panel). Do not list
every export of the libraries.

## Rules

- A scaffold must run. Never hand over a project you have not at least typechecked, and never describe a feature you did not
  write.
- No server, no auth, no upload, no key, no paid service unless the user asks for one. The whole point is that it runs in
  the browser.
- Do not vendor, copy or fork the Elah package source into the scaffold; install from npm.
- Do not touch anything outside the project folder (and, for the add-to-my-app route, outside the files you named).
- Keep the user's product name and wording. Do not invent a brand, a logo or pricing.
