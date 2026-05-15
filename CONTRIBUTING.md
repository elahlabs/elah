# Contributing

> This project is in **foundation phase**. Until [`ROADMAP.md`](./ROADMAP.md) PR-06 is merged, the priority is the six sequenced foundation PRs in [`docs/backlog/`](./docs/backlog/) — not new features.

---

## How to pick up work

1. Open [`ROADMAP.md`](./ROADMAP.md). Find the lowest-numbered PR with status 🔴 Not started or 🟡 In progress.
2. Open the corresponding ticket in `docs/backlog/PR-NN-*.md`.
3. The ticket has everything you need: scope, acceptance criteria, out-of-scope, implementation notes, and a copy-paste prompt for an implementation agent.
4. Create a branch: `git checkout -b pr-NN-<short-slug>` (e.g. `pr-01-engine-invariants`).
5. Implement, verify, open a PR. Acceptance criteria are the review checklist.

---

## Branch & commit conventions

### Branch names

`pr-<NN>-<short-slug>` for foundation work; `feat/<slug>`, `fix/<slug>`, `chore/<slug>` for everything else.

### Commit messages

Single line, no body unless really needed:

```
<area>: <verb> <object>

examples:
  engine: enforce overlap on moveClip
  resolver: handle track solo for image clips
  ui: extract EditorProvider from Timeline
  docs: add glossary entry for "stage"
```

`<area>` values: `engine`, `playback`, `resolver`, `media`, `ui`, `types`, `tests`, `docs`, `build`, `chore`.

---

## PR rules

### Every PR must:

1. Pass `npm run typecheck` at the repo root.
2. Pass any test suites that exist (once PR-02 lands, the resolver suite is mandatory).
3. Smoke-test in `apps/playground` — confirm the demo still works as expected after the change.
4. Touch only files within the documented scope of the ticket. Out-of-scope changes get their own PR.

### Every PR should:

5. Keep the diff under ~400 lines of net new code unless the ticket explicitly says otherwise. If it's larger, split it.
6. Add or update docs when public API changes.
7. Update `ROADMAP.md`'s status table if the PR is a foundation PR.

### PRs that won't be merged:

- "While I was in here, I also …" — open a separate PR.
- "I refactored the existing code to be cleaner …" — propose first, refactor second.
- "I added a plugin system because …" — see [`ARCHITECTURE.md` § 9](./ARCHITECTURE.md#9-what-this-architecture-rejects-anti-patterns).
- PRs with new dependencies that aren't justified by a ticket. The dependency surface is intentionally small.

---

## Working with implementation agents

If you're handing a ticket to an AI coding agent (Sonnet, GPT, Cursor agent mode, etc.), use the **copy-paste prompt** at the bottom of each PR ticket as the entire message. It contains:

- The hard constraints (don't redesign architecture, don't split packages, etc.).
- The scope.
- The acceptance criteria.
- The verification steps.
- The non-goals.

This format prevents scope creep and "agent enthusiasm" from contaminating the foundation work.

After the agent finishes, **you** are responsible for review. Walk through each acceptance criterion. If any criterion is unmet, request a fix; don't merge.

---

## Code style

- TypeScript strict mode is required.
- Prefer `interface` for object shapes that may be extended; `type` for unions and aliases.
- JSDoc the *why*, never the *what*. `// increments counter` on `counter++` is noise.
- Don't add comments that explain the change you just made — that's what the commit message is for.
- 2-space indent. Single quotes. No semicolons (matches existing code).

---

## When in doubt

- Read [`ARCHITECTURE.md`](./ARCHITECTURE.md). The answer is usually there.
- If the architecture doc doesn't cover it, propose a [Decisions log](./ROADMAP.md#decisions-log) entry in your PR description.
- If you're changing a design principle (P1–P6 in `ARCHITECTURE.md` § 1), the PR is a discussion, not a code change. Start with an issue.
