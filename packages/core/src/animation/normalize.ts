import type { AnimationChannel, ShapeAnimation, TextAnimation } from '../types'
import { toFrame } from '../utils/frames'

function duration(value: number): number {
  return Math.max(1, toFrame(value))
}

export function normalizeAnimationChannels(channels: AnimationChannel[]): AnimationChannel[] {
  return channels.map((channel) => ({
    ...channel,
    keyframes: channel.keyframes.map((keyframe) => ({
      ...keyframe,
      frame: toFrame(keyframe.frame),
    })),
  }))
}

export function normalizeTextAnimation(animation: TextAnimation): TextAnimation {
  return {
    ...animation,
    durationFrames: duration(animation.durationFrames),
    ...(animation.inDurationFrames !== undefined
      ? { inDurationFrames: duration(animation.inDurationFrames) }
      : {}),
    ...(animation.outDurationFrames !== undefined
      ? { outDurationFrames: duration(animation.outDurationFrames) }
      : {}),
    ...(animation.loopDurationFrames !== undefined
      ? { loopDurationFrames: duration(animation.loopDurationFrames) }
      : {}),
  }
}

export function normalizeShapeAnimation(animation: ShapeAnimation): ShapeAnimation {
  return { ...animation, durationFrames: duration(animation.durationFrames) }
}
