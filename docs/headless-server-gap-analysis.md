# Headless server gap analysis — `@elah/cli` as an AI-backend video editor

*Written 2026-07-11. Assessment of what stands between the current `@elah/cli`
package and the target use case: a headless, server-side video editor that any
AI layer (script generation, TTS, asset generation) can drive programmatically.
Browser support for this workflow is explicitly out of scope for now.*

## Summary

The CLI already solves the hardest problem — a working headless export with
**editor parity by construction** — but it is currently shaped as a one-shot
command-line tool, and an AI backend needs a long-running, programmable
rendering service. The gaps fall into three tiers: structural (blocks the use
case), throughput/robustness, and spec feature coverage.

## What exists today

- `elah build` consumes a seconds-based JSON spec (the AI-generation contract),
  probes real media durations, and constructs the project through
  `TimelineEngine` — so overlaps, track caps and source bounds are validated
  with path-addressed errors (`clips[2].duration must be …`) that a generating
  model can self-correct from.
- `elah split` / `trim` / `build` run in plain Node against the engine.
- `elah export` launches system Google Chrome headlessly (Playwright) and runs
  core's *real* `exportVideo` in it, so CLI output is bit-identical to Editor
  output by construction (`packages/cli/src/commands/export.ts`,
  `packages/cli/src/lib/harness.ts`).
- A parity harness (`scripts/parity-compare.mjs`) verifies editor-vs-CLI
  exports: identical decoded-video hashes; a small known AAC residual delta in
  the audio encode stage (both pipelines individually deterministic).

This is the same architecture Remotion uses at scale (headless Chrome +
WebCodecs on servers/Lambda). The approach is right; the gap is
productization.

## Industry context (July 2026)

The backend-video market the CLI would compete in:

- **JSON-spec render APIs** — [Shotstack](https://shotstack.io/product/video-editing-api/),
  [Creatomate](https://creatomate.com/developers), [JSON2Video](https://json2video.com/):
  REST endpoints that accept a JSON timeline (clips, overlays, transitions,
  TTS voice-overs, auto-subtitles) and return a rendered file. Template +
  data-merge is the dominant usage model; no-code integrations (Zapier, Make,
  n8n) sit on top.
- **Code-as-video** — [Remotion](https://www.remotion.dev/): React components
  rendered in headless Chrome, fanned out across Lambda for parallel frame
  ranges. Its 2026 "Skills" layer targets exactly the elah thesis: an AI agent
  writes the composition, the engine renders it.
- **Node-native WebCodecs** — FFmpeg-backed WebCodecs shims for Node now exist
  ([webcodecs-node](https://github.com/Brooooooklyn/webcodecs-node)) with
  hardware-encoder support (NVENC/VAAPI/QSV/VideoToolbox). A browser-free
  render path is feasible in principle but would be a *third* renderer,
  violating elah's dual-renderer parity constraint — post-V1 research, not a
  requirement.

The market split: high-volume template rendering (thousands of videos/month)
vs. low-volume cinematic generation. elah's spec + engine-validated build
targets the former, which is where AI layers plug in.

## Tier 1 — structural limitations (block the server use case)

### 1. No programmatic API — the package is bin-only

`packages/cli/package.json` declares a `bin` but no `exports`/`main`. An AI
layer written in Node cannot `import { build, exportProject } from '@elah/cli'`
— it must shell out, parse stderr text for progress, and read stdout for JSON.
**This is the single biggest gap**: "any AI layer can be added" in practice
means "there is a library API to call." Exposing `runBuild`/`runExport` as
functions with a progress *callback* (instead of `\rexporting frame N/M` on
stderr) is mostly a refactor of code that already exists.

### 2. Cold start per export — no warm/daemon mode

Every export launches a fresh Chrome, a new page, and a new harness server,
then tears them all down. Chrome launch is ~1–3 s and hundreds of MB of RSS.
A backend rendering hundreds of clips a day wants a persistent browser with a
page-per-job pool, or an `elah serve` mode with job-queue semantics. The
competitors are literally REST APIs; the spec format is already their JSON
contract — what is missing is the resident process around it.

### 3. The Chrome dependency on servers is undocumented/unowned

`packages/cli/src/lib/browser.ts` requires *branded* Chrome/Edge because
Playwright's bundled Chromium lacks H.264/AAC. On a Linux container that means
installing Chrome plus its ~40 shared-library dependencies; Chrome (unlike
Chromium) has redistribution restrictions for baked images. The browser does
not need to be eliminated (Remotion proved that) — the *environment* needs to
be owned:

- an official `elah/render` Dockerfile / base image,
- a documented bare-Ubuntu / ECS / Cloud Run path,
- a GPU story (headless Chrome falls back to software encode without the right
  flags — correct but slow),
- font provisioning (see Tier 3 #1: bare containers ship no fonts).

Without this, every adopter re-derives the deployment story.

## Tier 2 — throughput and robustness

### 4. Sequential single-worker export

Core's export is one worker rendering frames in order — no parallelism
(`packages/core/src/export/README.md`). The deterministic
`(project, frame) → pixels` contract already permits N workers over frame
ranges with a single mux; that is the scaling story for long jobs and the
prerequisite for serverless fan-out (the Remotion Lambda model).

### 5. Audio pipeline is not hardened

The mix runs on the main thread in one `OfflineAudioContext`,
whole-file-decoding every audio clip — flagged in core's own docs as "not
hardened for very long or many-clip timelines." AI workflows skew toward
exactly that shape (TTS voiceover + music bed + per-scene SFX). Memory blowup
on a long multi-track timeline is the likely first production incident.

### 6. Job semantics are CLI-grade, not worker-grade

- A tab crash or browser disconnect kills the job; no retry, no checkpoint.
- Progress is human-oriented stderr text; no `--json` event stream for an
  orchestrator.
- Results write to a local path only; no upload-to-S3/webhook hooks, no
  cross-job asset caching for repeated media.

Small items individually, but collectively the difference between "CLI" and
"render worker."

## Tier 3 — spec feature gaps for AI-generated content

Verified against `packages/cli/src/lib/spec.ts`: the spec covers
video/text/image/audio clips with position/scale/opacity/volume. Missing, in
order of how much the AI-video market cares:

1. **Custom fonts** — `fontFamily` only works if the font is installed in the
   headless environment; brand templates need a `fonts: { name: url|path }`
   block. On a bare Linux container there is often no Arial — or no fonts at
   all.
2. **Timed captions/subtitles** — word-level karaoke captions are *the*
   dominant feature of AI short-form pipelines (every TTS workflow needs
   them). Accepting an SRT file or a word-timestamps array on a text track
   would cover it.
3. **Transitions** — core has fade; the spec cannot express it. Slide/wipe are
   already on the V1 list.
4. **Keyframed properties** — animated position/scale/opacity over a clip's
   life. This separates "slideshow" output from "edited video" output.

## Recommended order

Tier 1 compounds: the programmatic API (#1) is what a serve mode (#2) is built
on, and the Docker image (#3) is what makes both deployable. In Tier 3, fonts
and captions are the highest-leverage spec additions because they are what
AI-pipeline customers evaluate first. Tier 2 can follow demand.

## Sources

- [Shotstack Edit API](https://shotstack.io/product/video-editing-api/)
- [JSON2Video](https://json2video.com/)
- [Creatomate developers](https://creatomate.com/developers)
- [Remotion](https://www.remotion.dev/)
- [Remotion Skills / AI-agent workflow](https://gaga.art/blog/remotion-skills/)
- [7 best video APIs 2026 — Plainly](https://www.plainlyvideos.com/blog/video-api)
- [webcodecs-node — FFmpeg-backed WebCodecs for Node](https://github.com/Brooooooklyn/webcodecs-node)
- [Replit: browser-based render engine](https://blog.replit.com/browsers-dont-want-to-be-cameras)
- [Serverless FFmpeg scaling patterns](https://codegive.com/blog/serverless_ffmpeg.php)
