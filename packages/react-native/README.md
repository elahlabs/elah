# @elah/react-native

React Native binding for the Elah video engine: the same `Project` document, the same
`TimelineEngine` and the same `@elah/react` hooks as the web, on iOS and Android.

> **Status: pre-release, not on npm.** The timeline is being built first. The engine, the shared
> `EditorProvider` and the timeline model bundle for Hermes and run in the dev harness
> ([`apps/mobile`](../../apps/mobile/README.md)), verified on its web target so far; the first
> run on a phone is owed. The `<Timeline>` component is next. Contributor
> issues: [`docs/react-native/issues/`](../../docs/react-native/issues/README.md).

## Status

| Feature | State | Issue |
|---|---|---|
| Shared timeline math in `@elah/core` (zoom, ruler ticks, trim limits, track rules) | works | RN-T0 |
| Timeline model: lanes, move / trim / pinch reducers, engine commands | works (Node, 80 tests) | RN-T0 |
| Bundles under Metro / Hermes (via `@elah/core/engine`) | works (Android + iOS bundles) | RN-T1 |
| `EditorProvider` from this package | works | RN-T2 |
| Dev harness (`apps/mobile`) | works (bundles verified; first on-device run owed) | RN-T3 |
| `<Timeline>` lanes and clips | works (bundles verified; first on-device run owed) | RN-T4 |
| Ruler, playhead, seek | not yet | RN-T5 |
| Move, trim, pinch, selection, undo on device | not yet | RN-T6 to RN-T9 |
| `<Preview>` (Skia), video decode, audio, import, export | not yet | RN-P4 to RN-P10 |

## How the timeline model works

Every gesture is three pure steps and one side effect:

```ts
import {
  snapshotFromStores, beginMove, updateMove, endMove,
  applyEngineCommand, defaultCommandTargets,
} from '@elah/react-native'

// gesture start: freeze what the drag needs
const session = beginMove(clipId, snapshotFromStores())   // null if locked or missing

// every move: pure, returns what to draw
const preview = updateMove(session, { translationX, pointerY })
// preview.dx / preview.dy -> the block's transform; preview.startFrame -> a timecode label

// release: what to do, or null for a tap
const command = endMove(session, preview, snapshotFromStores())
if (command) applyEngineCommand(defaultCommandTargets(engine), command)
```

`applyEngineCommand` is the only function in the package that changes the engine or a store.
Trims work the same way (`beginTrim` / `updateTrim` / `endTrim`), and so does zoom
(`beginPinch` / `updatePinch`, `zoomAtPlayhead`, `fitToWindowZoom`).

Two differences from the web timeline, both deliberate:

- Trims stop at the neighbouring clip and at the source's first frame **during** the drag. The
  web finds out on release, when the engine rejects the trim and the block snaps back.
- The model never calls `engine.previewClip`. Live feedback is a visual transform; the project
  changes once, on release, through the engine's validated `moveClip` / `trimClip`.

## Develop

From the repo root:

```bash
npm run build --workspace=packages/core
npm run test --workspace=packages/react-native
npm run typecheck --workspace=packages/react-native
```

`src/timeline/model/` must stay platform-free: `src/dependencyRules.test.ts` fails if React,
React Native, gesture-handler, Reanimated or Skia is imported there. Components go in
`src/timeline/components/`.

Read [`docs/react-native/`](../../docs/react-native/README.md) before opening a PR.

## License

Apache-2.0
