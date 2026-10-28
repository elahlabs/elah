# RN-T1: Metro-safe imports: `@elah/core/engine`, and `@elah/react` off the root barrel

> **Done 2026-10-08 by the maintainer** (see `04-workstreams.md`, RN-T1). Kept as the record of what was asked; do not file.

**Depends on:** nothing. **Size:** M. **Device:** no.

## What problem does this solve?

No React Native app can import the engine today. Metro and Hermes reject `import.meta`, and
`@elah/core`'s root barrel reaches the one file that uses it (`export/exportVideo.ts`, the
export worker URL). Details: [`02-platform-audit.md`](../02-platform-audit.md) section 2.

There is a second, smaller problem that the audit did not list. `@elah/react` imports
`@elah/core`'s **root** barrel by value (`stores.ts`, `useMediaLibrary.ts`), and
`useMediaLibrary.ts` imports the browser importers `importFiles`, `importUrl` and `importBlob`.
So a core entry point on its own is not enough: `@elah/react` must stop reaching the root
barrel too. `@elah/react-native`'s timeline model imports the root barrel as well, which is fine
in Node and must change before Metro sees it.

## Proposed solution

1. Do **RN-P1** exactly as written in [`04-workstreams.md`](../04-workstreams.md): add
   `packages/core/src/engine.ts`, the `"./engine"` export, and the
   `engine.no-browser.test.ts` guard. Add `utils/timelineMath` to the entry and its allowlist.
2. In `@elah/react`, change value imports to `@elah/core/engine`. Type-only imports may stay on
   `@elah/core`; they are erased.
3. Split the media-library hook so the browser importers are not reached from the package
   root. One option: `useMediaLibrary` takes the importers as an argument, and `@elah/editor`
   passes the browser ones. Another: move the importer calls to `@elah/editor`. Pick the one
   with no public API break and write the choice in [`05-decisions.md`](../05-decisions.md).
4. In `packages/react-native/src`, change every value import from `@elah/core` to
   `@elah/core/engine`, and tighten `src/dependencyRules.test.ts` to ban value imports from the
   root `@elah/core`.
5. Confirm the store singletons are shared: `@elah/core` and `@elah/core/engine` must re-export
   the same module files, so `tracksStore` from either is the same object. Add a test.

## Acceptance criteria

- [ ] `npm run build:packages && npm run test && npm run typecheck` exit 0 at the root (paste output).
- [ ] The new core guard test fails when `export { exportVideo } from './export'` is added to
      `engine.ts` (paste the failure, then revert).
- [ ] `grep -rn "from '@elah/core'" packages/react/src packages/react-native/src` shows only
      `import type` lines.
- [ ] A test proves `tracksStore` from `@elah/core` and from `@elah/core/engine` is the same object.
- [ ] `npm run verify:examples` still passes against the published packages.

## Additional context

Out of scope: moving or editing any existing core module. If something portable cannot be
reached without dragging a browser module along, leave it out of the entry and list it in the PR.
