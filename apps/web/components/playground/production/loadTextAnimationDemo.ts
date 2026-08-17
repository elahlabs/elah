import {
  type TimelineEngine,
  type TimelineRef,
  type AnimationChannel,
  type TextAnimation,
  type Transform,
  selectionStore,
  usePlaybackStore,
} from '@elah/editor'
import type { RefObject } from 'react'

const CLIP_DURATION = 90
const PHASE_DURATION = 15

const CENTERED: Transform = {
  x: 0.5,
  y: 0.5,
  scale: 1,
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
}

interface DemoPreset {
  name: string
  content: string
  animation?: TextAnimation
  animations?: AnimationChannel[]
}

const PRESETS: DemoPreset[] = [
  {
    name: '01 · Fade',
    content: 'FADE · 15 FRAMES',
    animation: {
      in: 'fade',
      out: 'fade',
      durationFrames: PHASE_DURATION,
      easing: 'ease-out',
    },
  },
  {
    name: '02 · Slide Up',
    content: 'SLIDE UP · EASE OUT',
    animation: {
      in: 'slide',
      out: 'slide',
      durationFrames: PHASE_DURATION,
      direction: 'up',
      easing: 'ease-out',
    },
  },
  {
    name: '03 · Pop',
    content: 'POP · 15 FRAMES',
    animation: {
      in: 'pop',
      out: 'pop',
      durationFrames: PHASE_DURATION,
      easing: 'ease-out',
    },
  },
  {
    name: '04 · Typewriter',
    content: 'TYPEWRITER, FRAME BY FRAME',
    animation: {
      in: 'typewriter',
      out: 'fade',
      durationFrames: 36,
      outDurationFrames: PHASE_DURATION,
      easing: 'linear',
    },
  },
  {
    name: '05 · Pulse Loop',
    content: 'PULSE · 30 FRAME LOOP',
    animation: {
      in: 'fade',
      out: 'fade',
      loop: 'pulse',
      durationFrames: PHASE_DURATION,
      loopDurationFrames: 30,
      easing: 'ease-out',
    },
  },
  {
    name: '06 · Custom Keyframes',
    content: 'CUSTOM POSITION · SCALE · ROTATION',
    animations: [
      {
        property: 'opacity',
        keyframes: [
          { frame: 0, value: 0 },
          { frame: 12, value: 1, easing: 'ease-out' },
          { frame: 74, value: 1 },
          { frame: 89, value: 0, easing: 'ease-in' },
        ],
      },
      {
        property: 'transform.x',
        keyframes: [
          { frame: 0, value: 0.28 },
          { frame: 24, value: 0.5, easing: 'ease-out' },
          { frame: 65, value: 0.5 },
          { frame: 89, value: 0.72, easing: 'ease-in' },
        ],
      },
      {
        property: 'transform.scale',
        keyframes: [
          { frame: 0, value: 0.86 },
          { frame: 24, value: 1, easing: 'ease-out' },
          { frame: 65, value: 1 },
          { frame: 89, value: 0.94, easing: 'ease-in' },
        ],
      },
      {
        property: 'transform.rotation',
        keyframes: [
          { frame: 0, value: -0.06 },
          { frame: 24, value: 0, easing: 'ease-out' },
          { frame: 65, value: 0 },
          { frame: 89, value: 0.06, easing: 'ease-in' },
        ],
      },
    ],
  },
]

export interface LoadTextAnimationDemoDeps {
  engine: TimelineEngine
  timelineRef: RefObject<TimelineRef | null>
}

/** Populate existing elements lanes with a deterministic feature-review reel. */
export function loadTextAnimationDemo({
  engine,
  timelineRef,
}: LoadTextAnimationDemoDeps): void {
  const elementsTracks = engine.getProject().tracks.filter((track) => track.kind === 'elements')
  const track = elementsTracks[0]
  if (!track) throw new Error('The text animation demo requires an elements track')

  let firstClipId = ''
  engine.batch(() => {
    for (const elementsTrack of elementsTracks) {
      for (const clip of engine.getClipsOnTrack(elementsTrack.id)) {
        engine.removeClip(clip.id, elementsTrack.id)
      }
    }

    PRESETS.forEach((preset, index) => {
      const clip = engine.addClip({
        trackId: track.id,
        type: 'text',
        name: preset.name,
        startFrame: index * CLIP_DURATION,
        durationFrames: CLIP_DURATION,
        opacity: 0.94,
        transform: CENTERED,
        text: {
          content: preset.content,
          fontSize: index === PRESETS.length - 1 ? 54 : 64,
          color: '#f2f7ff',
          fontFamily: 'sans-serif',
          fontWeight: 'bold',
          textAlign: 'center',
        },
        ...(preset.animation ? { textAnimation: preset.animation } : {}),
        ...(preset.animations ? { animations: preset.animations } : {}),
      })
      if (!firstClipId) firstClipId = clip.id
    })
  }, 'Load text animation demo')

  const playback = usePlaybackStore.getState()
  playback.pause()
  playback.setCurrentFrame(0)
  selectionStore.getState().selectClip(firstClipId)
  selectionStore.getState().setActiveTrack(track.id)
  requestAnimationFrame(() => timelineRef.current?.fitToWindow())
}
