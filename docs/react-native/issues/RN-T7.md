# RN-T7: Edge handles to trim a clip

**Depends on:** RN-T4. **Size:** M. **Device:** yes.

## What problem does this solve?

Clips cannot be trimmed on mobile. The meaning is written and tested: `beginTrim` /
`updateTrim` / `endTrim` in `packages/react-native/src/timeline/model/trimGesture.ts`. This issue
is the handles and the visuals.

## Proposed solution

1. Show two handles on the **selected** clip only (finger-sized, at least 24 px wide hit area),
   so unselected clips stay easy to scroll past and long-press.
2. `Gesture.Pan()` per handle. `onStart`:
   `session = beginTrim(clip.id, 'left' | 'right', snapshotFromStores(), { handleWidthPx })`.
   Pass the real handle width: it sets the minimum duration so both handles stay grabbable.
3. `onUpdate`: `preview = updateTrim(session, translationX)`. Animate the block's left and width
   from `preview.startFrame * zoom` and `preview.durationFrames * zoom` through shared values.
   Show the new duration as a timecode.
4. `onEnd`: `endTrim(session, preview)` then `applyEngineCommand`. Cancel resets.

## Acceptance criteria

- [ ] Recording: trim A's right edge into B (it stops at B), trim A's left edge past its source
      start (it stops at the source's first frame), trim the Title freely to frame 0.
- [ ] The block never jumps on release: what you see at the end of the drag is what the engine
      commits (the model applies the source and neighbour bounds during the drag; this is the
      difference from the web).
- [ ] Undo reverts each trim in one step.
- [ ] Clips at 2x speed (`engine.setClipSpeed`) stop at half their source length.

## Additional context

The bounds come from `maxTrimDuration`, `minLeftTrimStart` and `neighbourBounds` in
`@elah/core`; their tests are in `packages/core/src/utils/timelineMath.test.ts`.
