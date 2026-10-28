# RN-T2: Move `EditorProvider` to `@elah/react`

> **Done 2026-10-08 by the maintainer** (see `04-workstreams.md`, RN-T2). Kept as the record of what was asked; do not file.

**Depends on:** nothing. **Size:** S. **Device:** no. **Good first issue.**

## What problem does this solve?

`EditorProvider` wires engine events into the read-only stores the timeline reads
(`engine.on('change') -> tracksStore.sync(...)`, the seek echo guard, the `project:loaded`
rewind). It has no DOM reference, but it lives in `@elah/editor`, which needs `react-dom`,
`lucide-react` and CSS. The mobile timeline needs the exact same wiring, and copying it would
fork the trickiest plumbing in the codebase.

## Proposed solution

Do **RN-P2** exactly as written in [`04-workstreams.md`](../04-workstreams.md): `git mv` the
file into `packages/react/src/`, fix its imports, keep `@elah/editor` re-exporting
`EditorProvider` and `EditorProviderProps` so no consumer changes, and add a jsdom test
(`engine.addClip` reaches `useTracksStore`; a store seek moves the engine; no echo seek).

Then re-export `EditorProvider` from `packages/react-native/src/index.ts` and add it to the
package README's status table.

## Acceptance criteria

- [ ] Release gate exits 0: `npm run build:packages && npm run test && npm run typecheck`.
- [ ] `grep -rn "EditorProvider" packages/editor/src` shows only re-exports.
- [ ] `grep -nE "document|window|HTMLElement" -r packages/react/src` finds nothing new.
- [ ] `@elah/react-native` exports `EditorProvider`.

## Additional context

Decision D11 in [`05-decisions.md`](../05-decisions.md) has the reasoning.
