# Contributing

> The foundation and the first feature wave have shipped. Work now is feature
> and hardening PRs against a live engine — not a sequenced foundation. Read
> [`ARCHITECTURE.md`](./ARCHITECTURE.md) before changing anything in `core/`.

---

## Installation

**Requirements:** Node 18+ and npm 9+.

```bash
# 1. Clone the repo
git clone https://github.com/elahlabs/elah.git
cd elah

# 2. Install dependencies (npm workspaces monorepo — always run from the root)
npm install

# 3. Build the packages (core → react → timeline → editor → cli, in dependency order)
npm run build:packages

# 4. Verify everything works
npm run typecheck
npm test

# 5. Start the dev site and playgrounds (apps/web, http://localhost:3001)
npm run dev
```

`npm run dev` serves `apps/web` on **port 3001**. `apps/web` aliases `@elah/*` to the
package *sources*, so edits under `packages/*/src` show up with Fast Refresh and need no
rebuild; everything else that imports a package gets the built `dist/` (see
[`AGENTS.md`](./AGENTS.md#the-srcdist-asymmetry--read-this-before-debugging-a-stale-build)).

Repo layout:

```
packages/core      # @elah/core: framework-agnostic engine, resolver, renderer, export (zero React)
packages/react     # @elah/react: editor context, store hooks, audio hooks
packages/timeline  # @elah/timeline: React timeline UI components and hooks
packages/editor    # @elah/editor: EditorProvider, Preview, panels; re-exports core, react and timeline
packages/cli       # @elah/cli: headless runtime (build/export/serve via system Chrome), versioned on its own
apps/web           # the elah.dev site, docs and in-browser playgrounds, started by `npm run dev`
apps/server        # render-server example built on @elah/cli
examples/          # standalone apps consuming @elah/editor from npm — not
                   # part of the workspace; see examples/README.md
```

---

## How to pick up work

1. Skim [`ROADMAP.md`](./ROADMAP.md) (current state) and
   [`CURRENT_LIMITATIONS.md`](./CURRENT_LIMITATIONS.md) (known gaps).
2. Pick a slice small enough to land in one reviewable PR.
   For the React Native binding, pick a workstream from
   [`docs/react-native/04-workstreams.md`](./docs/react-native/04-workstreams.md) instead (read
   [`docs/react-native/README.md`](./docs/react-native/README.md) first).
3. Branch, implement, verify (`npm run typecheck` + `npm test`), smoke-test in
   the dev app (`npm run dev`, then open the editor or a playground route), open a PR.

---

## Branch & commit conventions

**Branches:** `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`.

**Commit messages** — single line, `<area>: <verb> <object>`:

```
engine: enforce overlap on moveClip
resolver: handle track solo for image clips
renderer: rebuild VAO on context restore
export: encode audio mix in 1s chunks
docs: sync renderer architecture with shipped layers
```

`<area>` values: `engine`, `playback`, `resolver`, `renderer`, `media`,
`export`, `assets`, `ui`, `types`, `tests`, `docs`, `build`, `chore`.

---

## PR rules

When you open a PR, GitHub will load the [PR template](./.github/PULL_REQUEST_TEMPLATE.md) automatically — fill in every section, don't delete any.

When you open an issue, choose the right template:
- [Bug report](./.github/ISSUE_TEMPLATE/bug_report.md) — reproduction steps + environment
- [Feature request](./.github/ISSUE_TEMPLATE/feature_request.md) — problem + proposed solution + acceptance criteria

### Every PR must

1. Pass `npm run typecheck` at the repo root.
2. Pass `npm test` (the vitest suites of core, react, timeline, editor, cli and `apps/web`).
3. Smoke-test in the dev app (`npm run dev` serves `apps/web` on :3001) — confirm the editor
   and the playgrounds still work.
4. Touch only files within the change's scope. Unrelated cleanups get their own PR.

### Every PR should

5. Keep the diff focused. If it grows past a few hundred lines of net-new code, split it.
6. Update docs when public API or a documented contract changes (the list below).
7. Update [`docs/known-bugs.md`](./docs/known-bugs.md) when adding a deliberate
   workaround, and [`CURRENT_LIMITATIONS.md`](./CURRENT_LIMITATIONS.md) when
   shipping or closing a known gap.
8. Run `npm run lint:tokens` when you touch UI in `packages/timeline` or `packages/editor`
   (no raw colour literals; see [`docs/design-tokens.md`](./docs/design-tokens.md)).

### When you change the public API

An added or renamed export updates, in the same PR:

- the package barrel (`packages/<pkg>/src/index.ts`, and `packages/editor/src/index.ts`, which
  re-exports the public API of core, react and timeline);
- the README of every package it touches: `packages/core/README.md`,
  `packages/react/README.md`, `packages/timeline/README.md`, `packages/editor/README.md`,
  `packages/cli/README.md`;
- `/docs/api` (`apps/web/app/docs/api/page.tsx`) and any docs page that shows it;
- [`CHANGELOG.md`](./CHANGELOG.md) and `apps/web/config/changelog.ts` (the site reads the
  latter);
- [`docs/ai/ELAH_FOR_AI_AGENTS.md`](./docs/ai/ELAH_FOR_AI_AGENTS.md), which duplicates the API
  surface by design.

### Releases (maintainers)

The full checklist is in [`AGENTS.md`](./AGENTS.md#releases). The short form: bump the
versions, run `npm install --package-lock-only` **before tagging**, build, update `CHANGELOG.md`
and `apps/web/config/changelog.ts`, pass the release gate, then publish by hand in dependency
order `@elah/core` → `@elah/react` → `@elah/timeline` → `@elah/editor` → `@elah/cli`, one
`npm publish --workspace=packages/<pkg> --access public` at a time and **never**
`npm publish --workspaces`. Tag `v<version>` for the four lockstep packages (`v0.6.0`) and
`cli-v<version>` for the CLI (`cli-v1.0.0`).

### PRs that won't be merged

- "While I was in here, I also …" — open a separate PR.
- "I refactored the existing code to be cleaner …" — propose first, refactor second.
- "I added a plugin system because …" — see
  [`ARCHITECTURE.md` § 9](./ARCHITECTURE.md#9-what-this-architecture-rejects-anti-patterns).
- New dependencies without a clear justification. The dependency surface is
  intentionally small (see [`BUNDLE_STRATEGY.md`](./BUNDLE_STRATEGY.md)).

---

## Architectural invariants

Renderer and decode changes must preserve the load-bearing invariants. These are
enforced by tests and stated in full in
[`packages/core/src/renderer/EVOLUTION.md` § 3](./packages/core/src/renderer/EVOLUTION.md):

- `render(scene)` is synchronous and never awaits.
- The renderer reads only `Scene` — never `Project`, the engines, stores, or React.
- `Scene` is immutable; equal references are a render no-op.
- Async decode is out-of-band; a cache miss draws the last uploaded frame.
- `FrameCache` owns every cached frame and is the only thing that closes it.
- Time is integer frames; seconds appear only at the media boundary.
- All project mutations funnel through `TimelineEngine.commit()`.

The renderer subsystem additionally documents agent-facing guardrails in
[`renderer/AI-Rules.md`](./packages/core/src/renderer/AI-Rules.md).

---

## Code style

- TypeScript strict mode is required.
- `interface` for object shapes that may be extended; `type` for unions and aliases.
- JSDoc the *why*, never the *what*. `// increments counter` on `counter++` is noise.
- Don't add comments that narrate the change you just made — that's the commit message's job.
- 2-space indent. Single quotes. No semicolons (match the surrounding code).

---

## When in doubt

- Read [`ARCHITECTURE.md`](./ARCHITECTURE.md). The answer is usually there.
- If it isn't, add a [Decisions log](./ROADMAP.md#decisions-log) entry in your PR description.
- If you're changing a design principle (P1–P6 in `ARCHITECTURE.md` § 1), the PR
  is a discussion first. Open an issue.
