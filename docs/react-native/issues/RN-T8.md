# RN-T8: Pinch to zoom, and fit-to-window

**Depends on:** RN-T4. **Size:** S. **Device:** yes. **Good first issue.**

## What problem does this solve?

The zoom is fixed on mobile. The math is written and tested in
`packages/react-native/src/timeline/model/zoomGesture.ts`.

## Proposed solution

1. `Gesture.Pinch()` on the lanes. `onStart`:
   `session = beginPinch(zoom, scrollX, focalX)`, where `focalX` is the pinch midpoint in lane
   space (subtract the track-label column).
2. `onUpdate`: `{ zoom, scrollX } = updatePinch(session, e.scale, e.focalX - labelWidth)`.
   Show the zoom immediately by scaling the lanes' content (a transform), and scroll to `scrollX`.
3. `onEnd`: `applyEngineCommand(targets, { type: 'setZoom', zoom })` once, then `scrollTo(scrollX)`
   after the re-layout at the new width (the web defers its scroll correction to a layout effect
   for the same reason: scrolling before re-layout clamps against the old width).
4. `TimelineRef.fitToWindow()` using `fitToWindowZoom(laneWidth, totalFrames, fps)`, and
   `TimelineRef.zoomAtPlayhead(nextZoom)` using `zoomAtPlayhead(...)`, for toolbar buttons.

## Acceptance criteria

- [ ] Recording: the frame under your fingers stays under your fingers while pinching in and out.
- [ ] Zoom stops at `ZOOM_MIN` / `ZOOM_MAX` without jumping.
- [ ] `fitToWindow()` shows the whole fixture; on an empty project it shows 10 seconds.
- [ ] One `setZoom` per pinch, not one per update (log or spy in the harness).
