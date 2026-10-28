# RN-T6: Long-press-and-drag to move a clip

**Depends on:** RN-T4. **Size:** M. **Device:** yes.

## What problem does this solve?

Clips cannot be moved on mobile. The meaning of the gesture is already written and tested:
`beginMove` / `updateMove` / `endMove` in `packages/react-native/src/timeline/model/moveGesture.ts`.
This issue is the recogniser and the visuals.

## Proposed solution

1. On `ClipBlock`, compose `Gesture.LongPress()` then `Gesture.Pan()` (`Gesture.Simultaneous` /
   `activateAfterLongPress`) so a plain horizontal pan still scrolls the lanes.
2. `onStart` (JS): `session = beginMove(clip.id, snapshotFromStores(), { snapTolerancePx })`.
   `null` means locked or gone: do nothing (still select).
3. `onUpdate`: `preview = updateMove(session, { translationX, pointerY })`, where `pointerY` is
   the finger's y in lanes space (add the vertical scroll if the lanes scroll vertically). Write
   `preview.dx` / `preview.dy` into shared values that translate the block, and raise its
   z-index. Show `preview.startFrame` as a timecode bubble.
4. `onEnd`: `command = endMove(session, preview, snapshot)`; if non-null,
   `applyEngineCommand(defaultCommandTargets(engine), command)`. Reset the translation either way.
   `onFinalize` with a cancel: reset, apply nothing.
5. Light haptic on snap (when `preview.startFrame` lands on a snap point) is welcome, optional.

If `updateMove` runs in a worklet, pass the session in as plain data; it is pure. If it runs on
JS via `runOnJS`, that is also fine at this size. Say which in the PR.

## Acceptance criteria

- [ ] Recording on device: move A along V1, move A onto V2, try to drop A onto the Elements lane
      (it stays on V1), drop A half over B (it settles beside B, never overlapping).
- [ ] One undo reverts each move (use the harness, or RN-T9 if merged).
- [ ] The block follows the finger with no React re-render per move (profiler).
- [ ] No `engine.*` or `setState` call in the component; only `applyEngineCommand`.

## Additional context

Why not `engine.previewClip` during the drag: it throws when the live position overlaps a
neighbour. The model settles the drop into a gap first and then calls `moveClip`, which is what
the web `ClipBlock` does.
