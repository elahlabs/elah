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

# 3. Build the packages (core → timeline → editor, in dependency order)
npm run build:packages

# 4. Verify everything works
npm run typecheck
npm test

# 5. Start the dev playground (apps/web)
npm run dev
```

Repo layout:

```
packages/core      # framework-agnostic engine, resolver, renderer, export
packages/timeline  # React timeline UI components and hooks
packages/editor    # full React editor SDK (bundles core + timeline)
apps/web           # dev playground started by `npm run dev`
playground/        # standalone apps consuming @elah/editor from npm — not
                   # part of the workspace; see playground/README.md
```

---

## How to pick up work

1. Skim [`ROADMAP.md`](./ROADMAP.md) (current state) and
   [`CURRENT_LIMITATIONS.md`](./CURRENT_LIMITATIONS.md) (known gaps).
2. Pick a slice small enough to land in one reviewable PR.
3. Branch, implement, verify (`npm run typecheck` + `npm test`), smoke-test in
   the playground, open a PR.

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
2. Pass `npm test` (the editor package's vitest suites).
3. Smoke-test in `apps/playground` — confirm the demo still works.
4. Touch only files within the change's scope. Unrelated cleanups get their own PR.

### Every PR should

5. Keep the diff focused. If it grows past a few hundred lines of net-new code, split it.
6. Update docs when public API or a documented contract changes.
7. Update [`docs/known-bugs.md`](./docs/known-bugs.md) when adding a deliberate
   workaround, and [`CURRENT_LIMITATIONS.md`](./CURRENT_LIMITATIONS.md) when
   shipping or closing a known gap.

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
- JSDoc the _why_, never the _what_. `// increments counter` on `counter++` is noise.
- Don't add comments that narrate the change you just made — that's the commit message's job.
- 2-space indent. Single quotes. No semicolons (match the surrounding code).

---

## When in doubt

- Read [`ARCHITECTURE.md`](./ARCHITECTURE.md). The answer is usually there.
- If it isn't, add a [Decisions log](./ROADMAP.md#decisions-log) entry in your PR description.
- If you're changing a design principle (P1–P6 in `ARCHITECTURE.md` § 1), the PR
  is a discussion first. Open an issue.
