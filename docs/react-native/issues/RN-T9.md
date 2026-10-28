# RN-T9: Selection, delete, undo / redo, and a JSON round trip with the web

**Depends on:** RN-T4 (best after T6 and T7). **Size:** S. **Device:** yes.

## What problem does this solve?

Closes the v0 timeline: you can pick a clip, remove it, undo mistakes, and prove the project
you edited on a phone is the same document the web editor reads.

## Proposed solution

1. Tap a clip: `{ type: 'selectClip', clipId }`. Tap empty lane space: `{ type: 'clearSelection' }`.
   Both through `applyEngineCommand`.
2. A small exported `TimelineToolbar` (or documented render-prop) with Delete, Undo, Redo and
   Fit. Delete issues `removeClip` for each selected clip; Undo/Redo issue `undo`/`redo`;
   disabled states from `useTracksStore(s => s.canUndo)` / `s.canRedo`.
3. In the harness: an "Export JSON" button that shows `serializeProject(engine)` (copy to
   clipboard) and an "Import JSON" field that loads one with `readProjectDocument` +
   `engine.loadProject`.

## Acceptance criteria

- [ ] Recording: select, delete, undo, redo.
- [ ] Round trip: edit the fixture on device (move + trim), copy the JSON, load it in the
      elah.dev playground; the web timeline shows the same clips at the same frames
      (screenshot of both). And the reverse: a project saved on the web opens on device.
- [ ] `packages/react-native/README.md` status table updated; this closes the timeline v0 row.

## Additional context

After this lands, the timeline-first track is complete. The next track is the preview
(RN-P4 onwards in [`04-workstreams.md`](../04-workstreams.md)).
