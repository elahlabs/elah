/**
 * Samples an AAC encoder puts in front of the audio it was given.
 *
 * AAC is a block codec: the encoder emits priming samples before the first real
 * one, and the container is supposed to declare them so a player skips them.
 * The muxer writes no such edit list, so they play — measured on a clean
 * single-clip export, the sound arrived 48 ms after its picture, every time,
 * with no drift. 2112 samples at 44.1 kHz is 47.9 ms, which is that number.
 */
const AAC_ENCODER_DELAY_FRAMES = 2112

/**
 * How many frames to drop off the FRONT of a mix so the encoder's own priming
 * takes their place and the sound lands where the picture is.
 *
 * The cost is the first 48 ms of the creative's own sound; the alternative is
 * 48 ms of lip sync error on every creative, which is past the point where
 * people see it. Only AAC does this — the other codecs an output may carry
 * declare their own pre-skip, so they are left alone.
 */
export function encoderPrimingFrames(codec: string, availableFrames: number): number {
  if (codec !== 'aac') return 0
  return Math.max(0, Math.min(AAC_ENCODER_DELAY_FRAMES, availableFrames))
}
