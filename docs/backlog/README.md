# Backlog

> Self-contained tickets for the **foundation phase** (PR-01 → PR-06) plus the post-foundation roadmap (PR-07+).

Each ticket is designed to be picked up cold — by you, by a teammate, or by an implementation agent — and shipped in one focused session. Read the ticket top to bottom; the **copy-paste prompt** at the bottom is what you hand to an AI coding agent.

---

## Foundation phase (sequential — do not parallelize)

| # | Title | Status | Why this PR matters |
|---|---|---|---|
| [PR-01](./PR-01-engine-invariants.md) | Engine invariants: `moveClip` + `trimClip` | 🟢 Merged | Drag/drop will exercise both functions immediately; bugs become reproducible-by-user-gesture |
| [PR-02](./PR-02-resolver-tests.md) | `resolveTimeline` tests | 🔴 Not started | The resolver runs 60×/sec under the renderer; bugs are invisible without tests |
| [PR-03](./PR-03-schema-stage-transform.md) | Schema: `Project.stage` + `Clip.transform?` | 🔴 Not started | Schema changes are cheapest before consumers exist |
| [PR-04](./PR-04-media-library-skeleton.md) | `MediaLibrary` skeleton + asset model | 🔴 Not started | Every later PR imports from these types; settle the shape once |
| [PR-05](./PR-05-editor-provider.md) | `EditorProvider` and engine lift | 🔴 Not started | Gallery + Preview need to live as Timeline siblings, not its children |
| [PR-06](./PR-06-render-contract.md) | Render contract + drag plumbing seams | 🔴 Not started | The final "empty seats" the next agent fills in |

**Do not skip PRs.** Each protects the next from a class of bugs.

---

## Post-foundation

[PR-07-onwards.md](./PR-07-onwards.md) — sketched, not fully specified. After PR-06 lands, plan PR-07 in detail with fresh eyes.

---

## How to use a ticket

1. **Read the whole ticket.** Each one has Goal, Why, Scope, Acceptance Criteria, Out-of-Scope, Implementation Notes, Verification, and Copy-paste prompt.
2. **Verify scope.** If you find yourself wanting to change files outside the documented scope, **stop**. Open a follow-up ticket instead.
3. **Hand the copy-paste prompt to an agent**, or implement manually, your choice.
4. **Walk the acceptance criteria one by one** before opening the PR. They're the review checklist.
5. **Update the status** in this index and in [`ROADMAP.md`](../../ROADMAP.md) when the PR is merged.

---

## Status legend

- 🔴 **Not started**
- 🟡 **In progress** (someone has a branch open)
- 🟢 **Merged**
- ⚫ **Cancelled / superseded** (link to replacement)
