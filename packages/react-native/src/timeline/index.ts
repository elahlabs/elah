/**
 * The mobile timeline.
 *
 * `./model` is platform-free: lane layout, the move / trim / pinch reducers
 * and the command applier, tested in Node. `./components` renders it with
 * React Native and Reanimated: `<Timeline>` draws the lanes and clips and
 * scrolls (RN-T4); the ruler, playhead and gestures that drive the reducers
 * are RN-T5 to RN-T9 in `docs/react-native/04-workstreams.md`.
 */
export * from './model'
export * from './components'
