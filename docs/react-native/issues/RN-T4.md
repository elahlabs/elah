# RN-T4: `<Timeline>`: lanes, clip blocks, horizontal scroll

**Depends on:** RN-T3. **Size:** M. **Device:** yes.

## What problem does this solve?

The first visible piece of the mobile timeline. Nothing is interactive yet except scrolling;
every later issue adds a gesture to what this one draws.

## Proposed solution

0. Add `react-native`, `react-native-gesture-handler`, `react-native-reanimated` and
   `react-native-worklets` to `packages/react-native/package.json` `peerDependencies` (ranges
   that include what `apps/mobile` pins: gesture-handler ~2.32, Reanimated 4.5, Worklets 0.10 on
   Expo SDK 57). The harness already has them installed and `<GestureHandlerRootView>` at its
   root. Gesture-handler 2.x has the `Gesture.Pan()` / `GestureDetector` API used below.

In `packages/react-native/src/timeline/components/`:

1. `Timeline.tsx`: reads `useTracksStore(s => s.tracks)`, `s.clips`, `s.totalFrames` and
   `usePlaybackStore(s => s.zoom)`. Lays out lanes with `computeLaneSlots(tracks)`. Content width
   is `timelineContentWidth(totalFrames, zoom)` from `@elah/core`.
2. A horizontal `ScrollView` (or `Animated.ScrollView`) for the lanes, with a fixed track-label
   column on the left (name + kind icon; any icon set the harness has, the library takes an
   `renderTrackIcon` prop rather than depending on one).
3. `ClipBlock.tsx`: positioned with `clipRect(clip, zoom, lane)`. Colour by `clip.type`, name
   label, a lock badge when the track is locked. Selected state from
   `useSelectionStore(s => s.selectedClipIds.has(clip.id))` (selection itself is RN-T9).
4. Expose the scroll offset as a Reanimated shared value on a `TimelineRef`, because T5 to T8
   need it. Expose `scrollTo(x)` too.
5. Props: `style`, `trackLabelWidth?`, `onLayoutLanes?`. No `className`, no theme object yet;
   colours are a small exported `timelineColors` object until a theming issue exists.
6. Export `Timeline` and `TimelineRef` from the package barrel and flip the README status row.

## Acceptance criteria

- [ ] On device, the fixture shows three lanes, clips A, B and Title at the positions
      `clipRect` gives (screenshot; the frame numbers in the clip labels make it checkable).
- [ ] Scrolling is smooth with 200 clips (generate them in the harness); record a few seconds.
- [ ] No per-frame React state: scrolling causes zero re-renders of `ClipBlock` (React DevTools
      profiler screenshot).
- [ ] `npm run test --workspace=packages/react-native` still green; the dependency guard
      passes (components may import RN; the model may not).

## Additional context

Mirror only the layout of the web `TrackRow`/`ClipBlock`, not their code: those are DOM and
Tailwind. Virtualisation (`computeVisibleWindow` in `@elah/timeline`) can be a follow-up; note
in the PR whether 200 clips needed it.
