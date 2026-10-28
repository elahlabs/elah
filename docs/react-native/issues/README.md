# React Native timeline: issue drafts

> Status: drafts, not yet filed. Written 2026-10-08 against `dev` @ `63c74c5` plus the
> uncommitted RN-T0 base. File each one on GitHub as written; the title is the first heading.

These are the contributor issues for the **timeline-first** track described at the top of
[`../04-workstreams.md`](../04-workstreams.md). The base (RN-T0) is done: the math is in
`@elah/core` and the gesture model is in `packages/react-native/src/timeline/model/`, tested in
Node against the real engine. Every issue below is "wire a component to an existing, tested
function", except T1 to T3, which make it possible to run on a device at all.

| Issue | Title | Depends on | Size | Needs a device |
|---|---|---|---|---|
| [RN-T1](./RN-T1.md) | Metro-safe imports: `@elah/core/engine`, and `@elah/react` off the root barrel (**done**) | none | M | no |
| [RN-T2](./RN-T2.md) | Move `EditorProvider` to `@elah/react` (**done**) | none | S | no |
| [RN-T3](./RN-T3.md) | `apps/mobile`: Expo dev harness with a fixture project (**done**) | T1, T2 | M | yes |
| [RN-T4](./RN-T4.md) | `<Timeline>`: lanes, clip blocks, horizontal scroll | T3 | M | yes |
| [RN-T5](./RN-T5.md) | Ruler, playhead and tap-to-seek | T4 | S | yes |
| [RN-T6](./RN-T6.md) | Long-press-and-drag to move a clip | T4 | M | yes |
| [RN-T7](./RN-T7.md) | Edge handles to trim a clip | T4 | M | yes |
| [RN-T8](./RN-T8.md) | Pinch to zoom, and fit-to-window | T4 | S | yes |
| [RN-T9](./RN-T9.md) | Selection, delete, undo / redo, and a JSON round trip with the web | T4 | S | yes |

**T1 to T3 are done**: the harness runs (see [`apps/mobile/README.md`](../../../apps/mobile/README.md)). File **T4 to T9** only. T4 comes first; T5 to T9 can run in parallel once T4 is merged.

Suggested labels: `react-native`, `good first issue` (T5, T8), `help wanted` (all).

## Read before taking any of these

1. [`../README.md`](../README.md), then [`../03-architecture.md`](../03-architecture.md) section 4.8.
2. The "contract every timeline issue builds on" table in [`../04-workstreams.md`](../04-workstreams.md).
3. [`../06-contributing.md`](../06-contributing.md): commit areas, the review bar, device evidence.
4. The model's tests, `packages/react-native/src/timeline/model/*.test.ts`. They show every
   function's inputs and outputs better than prose.
