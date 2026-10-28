# RN-T5: Ruler, playhead and tap-to-seek

**Depends on:** RN-T4. **Size:** S. **Device:** yes. **Good first issue.**

## What problem does this solve?

You cannot see or move the playhead on mobile.

## Proposed solution

1. `Ruler.tsx`: ticks from `computeRulerTicks(fps, totalFrames, zoom, targetSpacingPx)` in
   `@elah/core`. Use a larger spacing than the web's 80 px (labels are harder to read on a
   phone); make it a prop. Scrolls with the lanes.
2. `Playhead.tsx`: a vertical line at `currentFrame * zoom - scrollX`. Drive its position from a
   Reanimated shared value updated by a `playbackStore.subscribe`, not from React state, so
   playback does not re-render the timeline every frame.
3. Tap or drag on the ruler seeks: `Gesture.Tap()` / `Gesture.Pan()` calling
   `applyEngineCommand(targets, { type: 'seek', frame: seekFrameAtX(x, scrollX, zoom) })`.
   Pause while scrubbing and resume after, as the web `Playhead` does.

## Acceptance criteria

- [ ] Ruler labels match the web ruler at the same zoom (`formatRulerLabel` is shared, so a
      screenshot of both at 1 s spacing is enough).
- [ ] Tapping the ruler moves the playhead to the tapped frame; the harness debug panel shows the
      same frame.
- [ ] Profiler shows no `Timeline` re-render per frame while the playhead moves.
- [ ] Any new pure helper has a test in `@elah/core` `timelineMath.test.ts`.
