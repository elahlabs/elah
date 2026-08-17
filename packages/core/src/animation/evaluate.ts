import type {
  AnimationChannel,
  AnimationDirection,
  AnimationEasing,
  Clip,
  TextAnimation,
  Transform,
} from '../types'

const DEFAULT_TRANSFORM: Transform = {
  x: 0.5,
  y: 0.5,
  scale: 1,
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
}

const SLIDE_DISTANCE = 0.08
const POP_START_SCALE = 0.88
const PULSE_SCALE = 0.04

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** Apply one of Elah's deterministic, dependency-free easing curves. */
export function applyAnimationEasing(
  progress: number,
  easing: AnimationEasing = 'linear',
): number {
  const t = clamp01(progress)
  if (easing === 'ease-in') return t * t
  if (easing === 'ease-out') return t * (2 - t)
  if (easing === 'ease-in-out') {
    return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2
  }
  return t
}

/**
 * Evaluate a channel at a clip-relative frame. Values hold before the first
 * and after the last keyframe; invalid keyframes are ignored. The function
 * never mutates or reorders the stored channel.
 */
export function evaluateAnimationChannel(
  channel: AnimationChannel,
  localFrame: number,
): number | undefined {
  const keyframes = channel.keyframes
    .filter((keyframe) => Number.isFinite(keyframe.frame) && Number.isFinite(keyframe.value))
    .map((keyframe) => ({ ...keyframe, frame: Math.round(keyframe.frame) }))
    .sort((a, b) => a.frame - b.frame)

  if (keyframes.length === 0) return undefined
  if (localFrame < keyframes[0].frame) return keyframes[0].value

  let previous = keyframes[0]
  for (let index = 1; index < keyframes.length; index += 1) {
    const next = keyframes[index]
    if (localFrame < next.frame) {
      const span = next.frame - previous.frame
      if (span <= 0) return next.value
      const progress = applyAnimationEasing(
        (localFrame - previous.frame) / span,
        next.easing,
      )
      return previous.value + (next.value - previous.value) * progress
    }
    previous = next
  }

  return previous.value
}

export interface ResolvedTextAnimation {
  content: string
  opacity: number
  transform?: Transform
}

function phaseDuration(
  animation: TextAnimation,
  phase: 'in' | 'out' | 'loop',
): number {
  const specific = phase === 'in'
    ? animation.inDurationFrames
    : phase === 'out'
      ? animation.outDurationFrames
      : animation.loopDurationFrames
  return Math.max(1, Math.round(specific ?? animation.durationFrames))
}

function offsetForDirection(
  direction: AnimationDirection = 'up',
  amount: number,
): { x: number; y: number } {
  if (direction === 'left') return { x: -amount, y: 0 }
  if (direction === 'right') return { x: amount, y: 0 }
  if (direction === 'down') return { x: 0, y: amount }
  return { x: 0, y: -amount }
}

function setAnimatedProperty(
  channel: AnimationChannel,
  value: number,
  state: { opacity: number; transform: Transform },
): void {
  if (channel.property === 'opacity') state.opacity = clamp01(value)
  else if (channel.property === 'transform.x') state.transform.x = value
  else if (channel.property === 'transform.y') state.transform.y = value
  else if (channel.property === 'transform.scale') state.transform.scale = Math.max(0, value)
  else if (channel.property === 'transform.rotation') state.transform.rotation = value
}

/**
 * Resolve custom keyframes and text presets into ordinary render properties.
 * Renderers stay animation-agnostic: they receive only final content, opacity,
 * and transform for the requested frame.
 */
export function resolveTextAnimation(
  clip: Clip,
  localFrame: number,
): ResolvedTextAnimation {
  const baseTransform = clip.transform ?? DEFAULT_TRANSFORM
  const state = {
    opacity: clip.opacity ?? 1,
    transform: {
      ...baseTransform,
      anchor: { ...baseTransform.anchor },
    },
  }
  let hasTransform = clip.transform !== undefined

  for (const channel of clip.animations ?? []) {
    const value = evaluateAnimationChannel(channel, localFrame)
    if (value === undefined) continue
    setAnimatedProperty(channel, value, state)
    if (channel.property.startsWith('transform.')) hasTransform = true
  }

  const animation = clip.textAnimation
  const fullContent = clip.content ?? ''
  let visibleCharacters = Array.from(fullContent).length

  if (animation) {
    // Preserve the original fade preset's linear ramp for stored projects that
    // predate named easing. New inspector-created presets specify ease-out.
    const easing = animation.easing ?? 'linear'

    if (animation.in) {
      const duration = phaseDuration(animation, 'in')
      const progress = applyAnimationEasing(localFrame / duration, easing)

      if (animation.in === 'fade') state.opacity *= progress
      else if (animation.in === 'slide') {
        state.opacity *= progress
        const offset = offsetForDirection(animation.direction, SLIDE_DISTANCE * (1 - progress))
        state.transform.x += offset.x
        state.transform.y += offset.y
        hasTransform = true
      } else if (animation.in === 'pop') {
        state.opacity *= progress
        state.transform.scale *= POP_START_SCALE + (1 - POP_START_SCALE) * progress
        hasTransform = true
      } else if (animation.in === 'typewriter') {
        visibleCharacters = Math.min(
          visibleCharacters,
          Math.floor(Array.from(fullContent).length * progress),
        )
      }
    }

    if (animation.out) {
      const duration = phaseDuration(animation, 'out')
      const remaining = clip.durationFrames - 1 - localFrame
      const progress = applyAnimationEasing(remaining / duration, easing)

      if (animation.out === 'fade') state.opacity *= progress
      else if (animation.out === 'slide') {
        state.opacity *= progress
        const offset = offsetForDirection(animation.direction, SLIDE_DISTANCE * (1 - progress))
        state.transform.x += offset.x
        state.transform.y += offset.y
        hasTransform = true
      } else if (animation.out === 'pop') {
        state.opacity *= progress
        state.transform.scale *= POP_START_SCALE + (1 - POP_START_SCALE) * progress
        hasTransform = true
      } else if (animation.out === 'typewriter') {
        visibleCharacters = Math.min(
          visibleCharacters,
          Math.floor(Array.from(fullContent).length * progress),
        )
      }
    }

    if (animation.loop === 'pulse') {
      const duration = phaseDuration(animation, 'loop')
      const phase = ((localFrame % duration) + duration) % duration / duration
      const pulse = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2)
      state.transform.scale *= 1 + PULSE_SCALE * pulse
      hasTransform = true
    }
  }

  return {
    content: Array.from(fullContent).slice(0, visibleCharacters).join(''),
    opacity: clamp01(state.opacity),
    ...(hasTransform ? { transform: state.transform } : {}),
  }
}
