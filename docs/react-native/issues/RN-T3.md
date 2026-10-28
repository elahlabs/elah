# RN-T3: `apps/mobile`: Expo dev harness with a fixture project

> **Done 2026-10-08 by the maintainer** (see `04-workstreams.md`, RN-T3). Kept as the record of what was asked; do not file.

**Depends on:** RN-T1, RN-T2. **Size:** M. **Device:** yes (simulator or emulator is enough).

## What problem does this solve?

There is nowhere to run the timeline. Every later issue needs a screen that mounts
`EditorProvider` with a known project and shows the component under test.

## Proposed solution

1. Create `apps/mobile` with `create-expo-app` (SDK 57, New Architecture on, Hermes). Add it to
   the root `workspaces` (it already matches `apps/*`) and make `npm run typecheck` include it.
2. `metro.config.js`: `watchFolders: [repoRoot]`, and alias `@elah/core/engine`, `@elah/react`
   and `@elah/react-native` to their `src/` entries for Fast Refresh, mirroring
   `apps/web/next.config.mjs`. Do not alias the root `@elah/core`: if anything resolves it,
   the bundle must fail loudly (that is RN-T1's guarantee).
3. Install the timeline peers in the harness: `react-native-gesture-handler` 3.x,
   `react-native-reanimated` 4.x (+ `react-native-worklets`). Add them to
   `packages/react-native/package.json` as `peerDependencies` and the reason to
   [`05-decisions.md`](../05-decisions.md). No Skia yet; the timeline does not need it.
4. A fixture project in code: the same three lanes as
   `packages/react-native/src/timeline/model/__fixtures__/project.ts` (two video lanes, one
   elements lane, clips A, B and a title) so device behaviour can be compared with the tests.
5. One screen: `EditorProvider` with the fixture, a debug panel listing tracks and clips from
   `useTracksStore` and the current frame from `usePlaybackStore`, and a slot for `<Timeline>`.

## Acceptance criteria

- [ ] `npm run typecheck` passes at the root with `apps/mobile` included.
- [ ] `npx expo run:ios` or `run:android` starts the harness with no Babel `import.meta`
      workaround. Screenshot of the debug panel showing the fixture's clips.
- [ ] Bundling fails if a file imports the root `@elah/core` by value (try it, paste the
      error, revert).
- [ ] `docs/react-native/06-contributing.md` "Commands" section updated if anything differs.

## Additional context

Expo is the harness, not a requirement of the library (decision D10): no `expo-*` import may
appear under `packages/react-native/src`. This is a cut-down RN-P0 + RN-P3; the
`ElahMedia.probe` native module and the Skia spike stay in those workstreams.
