import type { HybridObject, UInt64 } from 'react-native-nitro-modules'

/**
 * RN-P6 / D6 spike: the one call the decision hinges on.
 *
 * `getFrame` stands in for `NativeFrameProvider.getCurrent(sourceFrame)`: it is
 * synchronous and returns the native pointer of a GPU-shareable frame (a
 * `CVPixelBufferRef` on iOS, an `AHardwareBuffer*` on Android), or nothing on a
 * miss. The pixels never touch the JS heap; react-native-webgpu wraps the
 * pointer and copies the frame on the GPU into a texture on Skia's device.
 *
 * The pool is a fixed set of test frames, not a decoder. D6 measured this
 * against an Expo Modules variant and chose Nitro (05-decisions.md).
 */
export interface FrameSpike extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  /** Baseline: the cost of one JS -> native -> JS round trip. */
  noop(): number
  /** Allocates `count` frames of `width` x `height`, each stamped with its index. */
  createPool(count: number, width: number, height: number): void
  /** Borrowed pointer to frame `index`, valid until `destroyPool`; `undefined` if out of range. */
  getFrame(index: number): UInt64 | undefined
  destroyPool(): void
}
