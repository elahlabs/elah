# Intern Brief — Sprint V1 (25–30 May 2026)

> **Welcome.** This document is everything you need to contribute to the v1.0.0 release of `@elah/editor`. Read it top-to-bottom before starting any task.

---

## What We Are Shipping

`@elah/editor` is an open-source, browser-native video editor SDK built on React + WebGL2. By end of Saturday 30 May, we will ship:

- GPU-accelerated multi-track video playback
- Image layer rendering (overlay images on video)
- Single audio track playback
- Text layer rendering
- Published on npm as `@elah/editor@1.0.0`
- Public GitHub repository
- Live documentation / landing page

**You are not implementing any of the above renderer code.** Your job is to make the code that already exists — and the code being written this week — presentable, documented, and discoverable by the open-source community.

---

## Setup (do this first, Sunday morning)

```bash
git clone <repo-url>
cd video-editor
npm install
npm run dev
```

Playground opens at `http://localhost:5173`. Try adding a video track, importing a file, adding a clip, and pressing Play.

If anything fails, post in the group chat immediately — do not spend more than 20 minutes debugging setup.

---

## Intern 1 — Docs + npm Package

### Your primary output
A polished npm package and documentation that makes a stranger want to use `@elah/editor` within 5 minutes of finding it.

### Sunday
- [ ] **npm name check** — run `npm search elah` and visit `npmjs.com` to check availability of:
  - `@elah/editor` ← preferred
  - `elah-editor`
  - `elah-video`
  - `@elah/core`
  - Document what is available in a note shared with the lead developer.

- [ ] **Block the npm name** — if `@elah/editor` is available, publish a placeholder package to claim it:
  1. Create a temp folder: `mkdir npm-placeholder && cd npm-placeholder`
  2. Create `package.json`:
     ```json
     {
       "name": "@elah/editor",
       "version": "0.0.1",
       "description": "Browser-native GPU video editor SDK — placeholder, v1.0.0 coming soon",
       "main": "index.js",
       "license": "MIT"
     }
     ```
  3. Create `index.js` with content: `// placeholder`
  4. Run `npm publish --access public`
  5. Confirm on npmjs.com that `@elah/editor@0.0.1` is listed.
  6. Tell the lead developer the name is blocked.

- [ ] **README audit** — read `README.md` and note anything that is:
  - Outdated (old working name, placeholder text, "Coming soon" for things that are now done)
  - Missing (screenshots, GIF demo, API reference link)
  - Unclear to a first-time visitor

### Monday
- [ ] **README Status table** — update to reflect current reality:
  ```markdown
  | GPU renderer (video, multi-track) | ✅ Working |
  | Image layer | ✅ Working |
  | Single audio track | ✅ Working |
  | Text layer | ✅ Working |
  | Export pipeline | ⚪ Not started |
  ```
  (Confirm with lead developer before marking layers ✅ — they're being built Tuesday–Thursday)

- [ ] **Quick Start polish** — follow the Quick Start instructions from a fresh terminal. Fix anything that does not work exactly as written.

- [ ] **"What's in v1.0.0" section** — add to README above the Contributing section:
  ```markdown
  ## What's in v1.0.0
  - Multi-track GPU video playback (WebGL2 + WebCodecs)
  - Image overlay layer
  - Single audio track with seek sync
  - Text overlay layer
  - Full decoder state machine (seek, seek-cancel, stuck-decode recovery)
  - Context-loss recovery (survives GPU resets and tab backgrounding)
  - Debug panel and `window.__GPU__` dev handle for integration testing
  ```

### Tuesday
- [ ] **Public API documentation** — open `packages/editor/src/index.ts`. For every exported symbol, write a one-line JSDoc if missing. The key exports are:
  - `GpuRenderer` — "WebGL2 renderer. `mount(container)` → `render(scene)` → `dispose()`."
  - `resolveTimeline` — "Pure resolver: `(frame, project) → Scene`. No side effects."
  - `createMediabunnyBackend` — "Creates a mediabunny-backed demuxer for real video decode."
  - `DemuxerBackend` — "Interface for custom demuxer implementations."
  - All Zustand hooks (`usePlaybackStore`, `useTracksStore`, etc.) — one-line each

- [ ] **Renderer architecture section in README** — add a collapsible or linked section:
  ```markdown
  ## Renderer Architecture
  The GPU renderer is a synchronous render tick fed by an async decode pipeline.
  See [`packages/editor/src/core/renderer/OPTIMIZATION.md`](./packages/editor/src/core/renderer/OPTIMIZATION.md)
  for the full layer-by-layer breakdown and debugging guide.
  ```

### Wednesday
- [ ] **Playground UI polish** — the playground is what visitors see in the demo. Make it look clean:
  - Consistent spacing and font sizes in the toolbar
  - Button disabled states should be visually obvious
  - "GPU Preview" label should show the debug counters when `debugMode` is on
  - No console errors or warnings (open DevTools, check the Console tab)

- [ ] **Keyboard shortcut legend** — add a small `?` button or footer row to the playground:
  ```
  Space — Play/Pause   |   S — Split   |   Ctrl+Z — Undo   |   Ctrl+Y — Redo   |   Ctrl+Scroll — Zoom
  ```

- [ ] **Cross-browser check** — test the playground in:
  - Chrome (primary target)
  - Firefox (note if anything is broken — WebCodecs may not be available)
  - Safari (note WebCodecs status)
  - Document your findings in a `BROWSER-COMPAT.md` in `docs/`

### Thursday
- [ ] **`CHANGELOG.md`** — create at workspace root:
  ```markdown
  # Changelog

  ## [1.0.0] — 2026-05-30

  ### Added
  - GPU-accelerated multi-track video playback via WebGL2 + WebCodecs
  - `ImageLayer` — static image clips render with transform, opacity, and correct zIndex compositing
  - `SingleAudioScheduler` — single audio track playback with seek sync
  - `TextLayer` — text clips rasterized via OffscreenCanvas, composited by zIndex
  - `FrameCache` with pivot-relative eviction (backward seek stability)
  - `VideoDecoderManager` full state machine with context-loss recovery
  - `GpuRendererDebugPanel` and `window.__GPU__` dev handle
  - `decodeTimeoutMs` watchdog for stuck-decode recovery
  - `resolveTimeline` solo/mute/zIndex/disabled support
  - `TimelineEngine` — undo/redo, batch commits, typed events
  - `PlaybackEngine` — anchor-and-integrate RAF clock

  ### Architecture
  - Renderer reads only `Scene` — zero coupling to React, Zustand, or engine internals
  - Frame ownership invariant enforced end-to-end (FrameCache owns, VideoLayer borrows, VideoTexture closes)
  - All 28+ Vitest suites covering decoder, cache, seek, ownership, and render synchronization
  ```

- [ ] **`package.json` polish** in `packages/editor/package.json`:
  - `"name": "@elah/editor"`
  - `"version": "1.0.0"`
  - `"description": "Browser-native GPU video editor SDK — frame-accurate, renderer-agnostic, React-friendly"`
  - `"keywords": ["video-editor", "webgl", "webcodecs", "timeline", "react", "gpu", "mediabunny"]`
  - `"author": "<your name>"`
  - `"homepage": "https://<your-domain>"`
  - `"repository": { "type": "git", "url": "https://github.com/<org>/<repo>" }`
  - `"license": "MIT"`

- [ ] **`files` field in `package.json`** — only ship what consumers need:
  ```json
  "files": ["dist", "src", "README.md", "LICENSE", "CHANGELOG.md"]
  ```

### Friday
- [ ] **Fresh clone install test** — in a completely separate directory, run:
  ```bash
  git clone <repo-url> elah-test
  cd elah-test
  npm install
  npm run dev
  ```
  Follow the Quick Start exactly as a first-time user would. Report any friction.

- [ ] **`npm pack --dry-run`** — run in `packages/editor`. Confirm the output file list includes `dist/`, source files, `README.md`, `LICENSE`, `CHANGELOG.md`. Does NOT include: test files (`__tests__/`), internal markdown docs, `node_modules`.

- [ ] **Review the GitHub release draft** — the lead developer will create a draft on Friday. Review it for clarity and correctness.

---

## Intern 2 — Domain, Landing Page, Launch

### Your primary output
A live domain, a minimal landing page, and a ready-to-fire set of social posts for Saturday morning.

### Sunday
- [ ] **Domain research** — check availability and price for:
  - `elah.dev` (preferred for a dev tool)
  - `elah.io`
  - `uselah.com`
  - `getlah.dev`
  - `elahvideo.com`
  - `elah-editor.dev`
  - Share your findings (name, registrar, price) in the group chat. Do not purchase until the lead developer approves.

- [ ] **GitHub repo review** — check:
  - Is `LICENSE` present and correct? ✅
  - Is `.gitignore` ignoring `node_modules`, `dist`, `.env`? ✅
  - Is the repo description set? (go to repo Settings → About)
  - Is the repo website field set? (set to the domain once purchased)
  - Are there any placeholder text or TODO comments in files visible to the public?

### Monday
- [ ] **Purchase the approved domain** (once lead developer confirms choice)
- [ ] **Set up hosting** — simplest option:
  - GitHub Pages: create a `docs/` folder or a `gh-pages` branch with a single `index.html`
  - OR Vercel: connect repo, deploy from `docs/` or a separate `landing/` folder
  - Confirm the domain resolves to your host

- [ ] **Landing page skeleton** — create `docs/index.html` (or use a simple framework like Astro or just vanilla HTML):
  ```html
  <!-- Minimum viable landing page -->
  <title>Elah — Browser-Native Video Editor SDK</title>
  <!-- Header: name + one-line description -->
  <!-- Install: npm install @elah/editor -->
  <!-- Links: GitHub, npm, Docs -->
  <!-- Status: v1.0.0 — coming Saturday 30 May -->
  ```
  It does not need to be fancy. Clean, dark theme, monospace code blocks.

### Tuesday
- [ ] **Landing page content** — fill in:
  - Hero: "A frame-accurate, GPU-accelerated video editor SDK for React"
  - Problem: "Building a browser video editor is hard. The data model, timeline, and renderer all need each other before any of them can be tested in isolation."
  - Solution: "Elah separates concerns cleanly. A pure resolver. A renderer-agnostic core. A GPU render pipeline that you can swap without touching your state."
  - Code block: the 20-line quick-start example from `README.md`
  - Links: `npm install @elah/editor` | GitHub | npm

- [ ] **Launch tweet draft** (280 chars, copy-paste ready):
  ```
  Shipping @elah/editor v1.0.0 — an open-source, browser-native video editor SDK.

  Frame-accurate. GPU-accelerated. Renderer-agnostic.
  Works with React. WebCodecs + WebGL2 under the hood.

  npm install @elah/editor

  🔗 <github-link>
  ```

- [ ] **Reddit post draft** for r/webdev / r/javascript:
  - Title: "I built an open-source browser video editor engine — GPU-accelerated, frame-accurate, renderer-agnostic [Show HN style]"
  - Body: what problem it solves (2–3 sentences), how it works (architecture in plain English, 3–4 sentences), what's in v1.0.0 (bullet list), GitHub link, npm link, invite for feedback

### Wednesday
- [ ] **Demo GIF** — once the lead developer has all four layers working in the playground (Wednesday/Thursday), record a 30-60 second demo:
  1. Open the playground
  2. Import a video file
  3. Add it to the timeline, play
  4. Scrub backward and forward
  5. Add a text overlay
  6. (If image/audio working) Add image clip and audio
  - Use LICEcap, ScreenToGif, or QuickTime → Gifski to create a GIF under 5 MB
  - Insert into README and landing page

- [ ] **LinkedIn post draft** — more professional tone, 3-4 paragraphs:
  - Paragraph 1: what you built
  - Paragraph 2: the technical challenge (deterministic playback, GPU pipeline, frame ownership)
  - Paragraph 3: what's in v1.0.0
  - Paragraph 4: link and call to action ("Try it, star it, open an issue")

### Thursday
- [ ] **Landing page — final content**:
  - Mobile responsive (check on your phone)
  - Dark theme (consistent with the playground aesthetic)
  - The demo GIF embedded
  - `npm install @elah/editor` in a copy-able code block
  - GitHub and npm links prominent
  - No placeholder text remaining

- [ ] **GitHub setup**:
  - Add issue labels: `bug`, `enhancement`, `good first issue`, `documentation`, `question`, `renderer`, `timeline`, `audio`
  - Add issue templates: one for bug reports, one for feature requests (GitHub Settings → Issue Templates)
  - Add a `DISCUSSIONS.md` welcome post or enable GitHub Discussions

- [ ] **Hacker News post draft** (for "Show HN"):
  ```
  Show HN: Elah – open-source browser video editor SDK (GPU, WebCodecs, frame-accurate)

  I built a browser-native video editor engine as an open-source SDK.
  [2-3 sentences on what makes it different]
  GitHub: <link> | npm: <link> | Demo: <playground-link>
  ```

### Friday
- [ ] **Landing page live** — confirm the domain resolves, page loads, all links work, demo GIF loads
- [ ] **All social posts finalized** — in a Google Doc or Notion page, formatted and approved by the lead developer
- [ ] **GitHub Discussions welcome thread** — draft a pinned post welcoming first visitors, explaining what the project is and what feedback you want

### Saturday — Launch Day
- [ ] **10:05** Post the launch tweet
- [ ] **10:10** Post to Reddit (r/webdev, r/javascript, r/reactjs) — don't post all three simultaneously; stagger by 30 minutes
- [ ] **10:15** Post to LinkedIn
- [ ] **10:30** Post "Show HN" to Hacker News (news.ycombinator.com/submit, title must start with "Show HN:")
- [ ] Monitor all channels and respond to questions quickly (within 1 hour of first comments)

---

## Communication Rules

1. **Post in group chat when you start a task and when you finish it.** Not a status meeting — just "Starting: npm name check" and "Done: npm name blocked as @elah/editor@0.0.1".
2. **Blocked for more than 20 minutes?** Post in chat immediately. Do not sit quietly.
3. **Do not commit code to `packages/editor/src/core/renderer/gpu/`.** That is the lead developer's territory. If you spot something in those files that looks like a bug or a doc error, mention it in chat — do not edit it.
4. **Do not change `ARCHITECTURE.md`, `OPTIMIZATION.md`, or any `.md` file in `packages/`.** Those are canonical technical docs maintained by the lead developer.
5. **When in doubt, ask.** It is always faster to ask than to undo.

---

## What Success Looks Like on Saturday

- `npm install @elah/editor` works and the playground starts in under 2 minutes from a fresh machine
- The landing page is live at the domain
- The GitHub repo is public with a clear README, GIF demo, and issue templates
- The launch tweet is posted and getting engagement
- No open bugs that make the demo fail

---

*Created: Sunday 25 May 2026. Questions → post in the shared channel.*
