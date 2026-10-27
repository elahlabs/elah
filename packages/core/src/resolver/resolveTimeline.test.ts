import { describe, it, expect } from 'vitest'
import { resolveTimeline } from './resolveTimeline'
import { embeddedAudioId, clipIdOfSceneAudio } from './scene'
import type { Project, Track, Clip, Paint, TextSpan } from '../types'

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: 'p1',
    fps: 30,
    stage: { width: 1080, height: 1920 },
    tracks: [],
    clips: {},
    transitions: [],
    version: 1,
    ...overrides,
  }
}

function makeTrack(overrides?: Partial<Track>): Track {
  return {
    id: overrides?.id ?? 't1',
    name: 'T',
    kind: 'video',
    order: 0,
    height: 64,
    locked: false,
    disabled: false,
    muted: false,
    solo: false,
    ...overrides,
  }
}

function makeClip(overrides?: Partial<Clip>): Clip {
  return {
    id: 'c1',
    trackId: 't1',
    type: 'video',
    name: 'C',
    startFrame: 0,
    durationFrames: 30,
    sourceStartFrame: 0,
    sourceDurationFrames: 30,
    src: 'fake.mp4',
    ...overrides,
  }
}

describe('resolveTimeline — shape geometry reaches the painter', () => {
  function resolveShape(clip: Partial<Clip>) {
    const project = makeProject({
      tracks: [makeTrack({ id: 'e1', kind: 'elements', order: 0 })],
      clips: {
        e1: [
          makeClip({
            id: 's1',
            trackId: 'e1',
            type: 'shape',
            src: undefined,
            shapeKind: 'rect',
            ...clip,
          }),
        ],
      },
    })
    return resolveTimeline(0, project).shapes[0]
  }

  it('carries every per-variant field through', () => {
    expect(
      resolveShape({
        shapeKind: 'polygon',
        shapeSides: 7,
        shapeInnerRatio: 0.4,
        shapeArrowHead: 'both',
        shapePath: 'M0 0',
        shapeViewBox: { x: 1, y: 2, width: 3, height: 4 },
        shapeFillRule: 'evenodd',
      }),
    ).toMatchObject({
      shapeKind: 'polygon',
      shapeSides: 7,
      shapeInnerRatio: 0.4,
      shapeArrowHead: 'both',
      shapePath: 'M0 0',
      shapeViewBox: { x: 1, y: 2, width: 3, height: 4 },
      shapeFillRule: 'evenodd',
    })
  })

  it('omits fields the clip does not carry', () => {
    const active = resolveShape({})
    expect(active.shapeSides).toBeUndefined()
    expect(active.shapePath).toBeUndefined()
    expect(active.cornerRadius).toBeUndefined()
  })

  it('carries a static corner radius', () => {
    expect(resolveShape({ cornerRadius: 0.25 }).cornerRadius).toBe(0.25)
  })

  /**
   * The point of reusing `cornerRadius` rather than adding a `shapeCornerRadius`
   * twin: the existing keyframe channel animates a shape's corners with no
   * sampler change at all.
   */
  it('samples a KEYFRAMED corner radius, like video and image do', () => {
    const project = makeProject({
      tracks: [makeTrack({ id: 'e1', kind: 'elements', order: 0 })],
      clips: {
        e1: [
          makeClip({
            id: 's1',
            trackId: 'e1',
            type: 'shape',
            src: undefined,
            shapeKind: 'rect',
            durationFrames: 11,
            cornerRadius: 0,
            keyframes: {
              channels: {
                cornerRadius: {
                  source: { kind: 'keyframes' },
                  keys: [
                    { id: 'k1', frame: 0, value: 0, easing: 'linear' },
                    { id: 'k2', frame: 10, value: 0.5, easing: 'linear' },
                  ],
                },
              },
            },
          }),
        ],
      },
    })
    expect(resolveTimeline(0, project).shapes[0].cornerRadius).toBeUndefined() // 0 is falsy → omitted
    expect(resolveTimeline(5, project).shapes[0].cornerRadius).toBeCloseTo(0.25, 6)
    expect(resolveTimeline(10, project).shapes[0].cornerRadius).toBeCloseTo(0.5, 6)
  })

  /** PV-P6a: the seven paint/dash/cap/join/align fields, same conditional-spread contract. */
  it('carries every PV-P6a paint/stroke field through', () => {
    const fillPaint: Paint = { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] }
    const strokePaint: Paint = { type: 'radial', cx: 0.5, cy: 0.5, r: 1, stops: [{ offset: 0, color: '#111' }, { offset: 1, color: '#eee' }] }
    expect(
      resolveShape({
        shapeFillPaint: fillPaint,
        shapeStrokePaint: strokePaint,
        shapeStrokeDash: [12, 6],
        shapeStrokeDashOffset: 3,
        shapeStrokeCap: 'round',
        shapeStrokeJoin: 'bevel',
        shapeStrokeAlign: 'inside',
      }),
    ).toMatchObject({
      shapeFillPaint: fillPaint,
      shapeStrokePaint: strokePaint,
      shapeStrokeDash: [12, 6],
      shapeStrokeDashOffset: 3,
      shapeStrokeCap: 'round',
      shapeStrokeJoin: 'bevel',
      shapeStrokeAlign: 'inside',
    })
  })

  it('omits the PV-P6a fields the clip does not carry', () => {
    const active = resolveShape({})
    for (const key of [
      'shapeFillPaint',
      'shapeStrokePaint',
      'shapeStrokeDash',
      'shapeStrokeDashOffset',
      'shapeStrokeCap',
      'shapeStrokeJoin',
      'shapeStrokeAlign',
    ] as const) {
      expect(key in active).toBe(false)
    }
  })
})

describe('resolveTimeline', () => {
  it('returns an empty scene for an empty project', () => {
    const project = makeProject({ tracks: [], clips: {} })
    const scene = resolveTimeline(0, project)

    expect(scene.frame).toBe(0)
    expect(scene.fps).toBe(30)
    expect(scene.stage).toEqual({ width: 1080, height: 1920 })
    expect(scene.videos.length).toBe(0)
    expect(scene.audios.length).toBe(0)
    expect(scene.texts.length).toBe(0)
    expect(scene.images.length).toBe(0)
    expect(scene.transitions.length).toBe(0)
  })

  it('propagates fps and stage from project into every Scene', () => {
    const project = makeProject({ fps: 60, stage: { width: 1920, height: 1080 }, tracks: [], clips: {} })
    const scene = resolveTimeline(42, project)

    expect(scene.fps).toBe(60)
    expect(scene.stage).toEqual({ width: 1920, height: 1080 })
  })

  it('includes a clip only when frame is inside its half-open range', () => {
    const track = makeTrack({ id: 't1', kind: 'video', order: 0 })
    const clip = makeClip({
      id: 'c1',
      trackId: 't1',
      type: 'video',
      startFrame: 10,
      durationFrames: 40,
      sourceStartFrame: 0,
      sourceDurationFrames: 40,
      src: 'fake.mp4',
    })
    const project = makeProject({ tracks: [track], clips: { t1: [clip] } })

    expect(resolveTimeline(9, project).videos.length).toBe(0)
    expect(resolveTimeline(10, project).videos.length).toBe(1)
    expect(resolveTimeline(49, project).videos.length).toBe(1)
    expect(resolveTimeline(50, project).videos.length).toBe(0)
  })

  it('orders overlapping clips with higher track.order in front — the first/topmost lane is the back layer', () => {
    const trackA = makeTrack({ id: 'tA', order: 0 })
    const trackB = makeTrack({ id: 'tB', order: 1 })
    const clipA = makeClip({
      id: 'cA', trackId: 'tA',
      startFrame: 0, durationFrames: 30,
      sourceStartFrame: 0, sourceDurationFrames: 30,
      src: 'a.mp4',
    })
    const clipB = makeClip({
      id: 'cB', trackId: 'tB',
      startFrame: 0, durationFrames: 30,
      sourceStartFrame: 0, sourceDurationFrames: 30,
      src: 'b.mp4',
    })
    const project = makeProject({
      tracks: [trackA, trackB],
      clips: { tA: [clipA], tB: [clipB] },
    })

    const scene = resolveTimeline(0, project)

    expect(scene.videos.length).toBe(2)
    expect(scene.videos[0].trackId).toBe('tA')
    expect(scene.videos[1].trackId).toBe('tB')
    expect(scene.videos[0].zIndex).toBeLessThan(scene.videos[1].zIndex)
  })

  it('honors track and clip flags (muted, disabled)', () => {
    // a) Video track muted → volume 0
    const mutedVideoTrack = makeTrack({ id: 'tv', kind: 'video', muted: true })
    const videoClip = makeClip({ id: 'cv', trackId: 'tv', type: 'video', src: 'v.mp4' })
    const sceneA = resolveTimeline(0, makeProject({
      tracks: [mutedVideoTrack],
      clips: { tv: [videoClip] },
    }))
    expect(sceneA.videos[0].volume).toBe(0)

    // b) Audio track muted → volume 0
    const mutedAudioTrack = makeTrack({ id: 'ta', kind: 'audio', muted: true })
    const audioClip = makeClip({ id: 'ca', trackId: 'ta', type: 'audio', src: 'a.mp3' })
    const sceneB = resolveTimeline(0, makeProject({
      tracks: [mutedAudioTrack],
      clips: { ta: [audioClip] },
    }))
    expect(sceneB.audios[0].volume).toBe(0)

    // c) Disabled track → no clips appear
    const disabledTrack = makeTrack({ id: 'td', kind: 'video', disabled: true })
    const disabledTrackClip = makeClip({ id: 'cd', trackId: 'td', type: 'video', src: 'v.mp4' })
    const sceneC = resolveTimeline(0, makeProject({
      tracks: [disabledTrack],
      clips: { td: [disabledTrackClip] },
    }))
    expect(sceneC.videos.length).toBe(0)

    // d) Disabled clip → absent; sibling clip on same track still present
    const track = makeTrack({ id: 'tt', kind: 'video' })
    const activeClip = makeClip({ id: 'c-on', trackId: 'tt', startFrame: 0, durationFrames: 30 })
    const offClip = makeClip({ id: 'c-off', trackId: 'tt', startFrame: 0, durationFrames: 30, disabled: true })
    const sceneD = resolveTimeline(0, makeProject({
      tracks: [track],
      clips: { tt: [activeClip, offClip] },
    }))
    expect(sceneD.videos.length).toBe(1)
    expect(sceneD.videos[0].id).toBe('c-on')
  })

  it('excludes non-solo tracks of the same kind when solo is set', () => {
    const trackA = makeTrack({ id: 'tA', kind: 'video', order: 0, solo: true })
    const trackB = makeTrack({ id: 'tB', kind: 'video', order: 1 })
    const audioTrack = makeTrack({ id: 'tAudio', kind: 'audio', order: 2 })

    const clipA = makeClip({ id: 'cA', trackId: 'tA', type: 'video', src: 'a.mp4' })
    const clipB = makeClip({ id: 'cB', trackId: 'tB', type: 'video', src: 'b.mp4' })
    const audioClip = makeClip({ id: 'cAudio', trackId: 'tAudio', type: 'audio', src: 'a.mp3' })

    const project = makeProject({
      tracks: [trackA, trackB, audioTrack],
      clips: { tA: [clipA], tB: [clipB], tAudio: [audioClip] },
    })

    const scene = resolveTimeline(0, project)

    expect(scene.videos.length).toBe(1)
    expect(scene.videos[0].trackId).toBe('tA')
    expect(scene.audios.length).toBe(1)
  })

  it('computes sourceFrame correctly at the start boundary and mid-clip', () => {
    const track = makeTrack({ id: 't1', kind: 'video' })
    const clip = makeClip({
      id: 'c1',
      trackId: 't1',
      type: 'video',
      startFrame: 10,
      durationFrames: 40,
      sourceStartFrame: 5,
      sourceDurationFrames: 40,
      src: 'v.mp4',
    })
    const project = makeProject({ tracks: [track], clips: { t1: [clip] } })

    expect(resolveTimeline(10, project).videos[0].sourceFrame).toBe(5)
    expect(resolveTimeline(20, project).videos[0].sourceFrame).toBe(15)
  })

  it('sourceFrame with speed=1 (or omitted) behaves exactly as before', () => {
    const track = makeTrack({ id: 't1', kind: 'video' })
    const clip = makeClip({
      startFrame: 0,
      durationFrames: 20,
      sourceStartFrame: 0,
      sourceDurationFrames: 20,
      speed: 1,
    })
    const project = makeProject({ tracks: [track], clips: { t1: [clip] } })

    for (let f = 0; f < 20; f++) {
      expect(resolveTimeline(f, project).videos[0].sourceFrame).toBe(f)
    }
  })

  it('sourceFrame at speed=2 advances through the source twice as fast as the playhead', () => {
    const track = makeTrack({ id: 't1', kind: 'video' })
    // 10 timeline frames covering source frames 0..19 at 2x.
    const clip = makeClip({
      startFrame: 0,
      durationFrames: 10,
      sourceStartFrame: 0,
      sourceDurationFrames: 20,
      speed: 2,
    })
    const project = makeProject({ tracks: [track], clips: { t1: [clip] } })

    expect(resolveTimeline(0, project).videos[0].sourceFrame).toBe(0)
    expect(resolveTimeline(1, project).videos[0].sourceFrame).toBe(2)
    expect(resolveTimeline(5, project).videos[0].sourceFrame).toBe(10)
    // Last timeline frame (9) must not read past the trim window (source frame 19).
    expect(resolveTimeline(9, project).videos[0].sourceFrame).toBe(18)
  })

  it('sourceFrame at speed=0.5 advances through the source at half the playhead rate', () => {
    const track = makeTrack({ id: 't1', kind: 'video' })
    const clip = makeClip({
      startFrame: 0,
      durationFrames: 10,
      sourceStartFrame: 0,
      sourceDurationFrames: 20,
      speed: 0.5,
    })
    const project = makeProject({ tracks: [track], clips: { t1: [clip] } })

    expect(resolveTimeline(0, project).videos[0].sourceFrame).toBe(0)
    expect(resolveTimeline(2, project).videos[0].sourceFrame).toBe(1)
    expect(resolveTimeline(9, project).videos[0].sourceFrame).toBe(4)
  })

  it('sourceFrame with speed honors a non-zero sourceStartFrame trim offset', () => {
    const track = makeTrack({ id: 't1', kind: 'video' })
    const clip = makeClip({
      startFrame: 0,
      durationFrames: 10,
      sourceStartFrame: 100,
      sourceDurationFrames: 220,
      speed: 2,
    })
    const project = makeProject({ tracks: [track], clips: { t1: [clip] } })

    expect(resolveTimeline(0, project).videos[0].sourceFrame).toBe(100)
    expect(resolveTimeline(5, project).videos[0].sourceFrame).toBe(110)
  })

  it('propagates clip-level opacity and volume; muted track overrides volume to 0', () => {
    const track = makeTrack({ id: 't1', kind: 'video', muted: false })
    const clip = makeClip({
      id: 'c1',
      trackId: 't1',
      type: 'video',
      src: 'v.mp4',
      opacity: 0.5,
      volume: 0.25,
    })

    const sceneUnmuted = resolveTimeline(0, makeProject({ tracks: [track], clips: { t1: [clip] } }))
    expect(sceneUnmuted.videos[0].opacity).toBe(0.5)
    expect(sceneUnmuted.videos[0].volume).toBe(0.25)

    const mutedTrack = makeTrack({ id: 't1', kind: 'video', muted: true })
    const sceneMuted = resolveTimeline(0, makeProject({ tracks: [mutedTrack], clips: { t1: [clip] } }))
    expect(sceneMuted.videos[0].volume).toBe(0)
    expect(sceneMuted.videos[0].opacity).toBe(0.5)
  })

  it('activates text clips and defaults missing content to empty string', () => {
    const track = makeTrack({ id: 'tt', kind: 'elements' })
    const clipWithContent = makeClip({
      id: 'c-text',
      trackId: 'tt',
      type: 'text',
      content: 'hello',
    })
    const scene = resolveTimeline(0, makeProject({ tracks: [track], clips: { tt: [clipWithContent] } }))

    expect(scene.texts.length).toBe(1)
    expect(scene.texts[0].content).toBe('hello')
    expect(typeof scene.texts[0].sourceFrame).toBe('number')
    expect(typeof scene.texts[0].zIndex).toBe('number')

    const clipNoContent = makeClip({ id: 'c-empty', trackId: 'tt', type: 'text' })
    const sceneEmpty = resolveTimeline(0, makeProject({ tracks: [track], clips: { tt: [clipNoContent] } }))
    expect(sceneEmpty.texts[0].content).toBe('')
  })

  it('passes text style fields through to the active text clip', () => {
    const track = makeTrack({ id: 'tt', kind: 'elements' })
    const styled = makeClip({
      id: 'c-styled',
      trackId: 'tt',
      type: 'text',
      content: 'styled',
      fontSize: 96,
      color: '#ff0000',
      fontFamily: 'Inter',
      fontWeight: 'bold',
      textAlign: 'left',
    })
    const scene = resolveTimeline(0, makeProject({ tracks: [track], clips: { tt: [styled] } }))
    const text = scene.texts[0]

    expect(text.fontSize).toBe(96)
    expect(text.color).toBe('#ff0000')
    expect(text.fontFamily).toBe('Inter')
    expect(text.fontWeight).toBe('bold')
    expect(text.textAlign).toBe('left')

    // Unstyled clip leaves the fields undefined (TextLayer applies defaults).
    const plain = makeClip({ id: 'c-plain', trackId: 'tt', type: 'text', content: 'x' })
    const scenePlain = resolveTimeline(0, makeProject({ tracks: [track], clips: { tt: [plain] } }))
    expect(scenePlain.texts[0].fontSize).toBeUndefined()
    expect(scenePlain.texts[0].color).toBeUndefined()
  })

  it('passes a bundled fontId through, and adds no key to a clip without one (PV-P4a-2)', () => {
    const track = makeTrack({ id: 'tt', kind: 'elements' })
    const bundled = makeClip({
      id: 'c-font',
      trackId: 'tt',
      type: 'text',
      content: 'title',
      fontId: 'inter',
      // A legacy family alongside it: the id wins at paint time, so the resolver
      // must carry BOTH and let textLayout decide, not drop the family here.
      fontFamily: 'Impact',
    })
    const scene = resolveTimeline(0, makeProject({ tracks: [track], clips: { tt: [bundled] } }))
    expect(scene.texts[0].fontId).toBe('inter')
    expect(scene.texts[0].fontFamily).toBe('Impact')

    // The conditional-spread rule every other optional field obeys: a clip that
    // names no font must gain NO key, not `fontId: undefined` — a legacy
    // document has to stay byte-identical through the resolver.
    const plain = makeClip({ id: 'c-plain', trackId: 'tt', type: 'text', content: 'x' })
    const scenePlain = resolveTimeline(0, makeProject({ tracks: [track], clips: { tt: [plain] } }))
    expect('fontId' in scenePlain.texts[0]).toBe(false)
  })

  it('carries a numeric weight and italic through, and adds no fontStyle key to a legacy clip (PV-P4b)', () => {
    const track = makeTrack({ id: 'tt', kind: 'elements' })
    const styled = makeClip({
      id: 'c-italic',
      trackId: 'tt',
      type: 'text',
      content: 'slanted',
      fontId: 'inter',
      // A NUMBER, not the 'normal' | 'bold' union older documents hold. The whole
      // point of PV-P4b's type change is that this reaches the resolver intact.
      fontWeight: 900,
      fontStyle: 'italic',
    })
    const scene = resolveTimeline(0, makeProject({ tracks: [track], clips: { tt: [styled] } }))
    expect(scene.texts[0].fontWeight).toBe(900)
    expect(scene.texts[0].fontStyle).toBe('italic')

    // Same conditional-spread rule as every other optional field: a legacy clip
    // must gain NO key, so it still paints the byte-identical pre-P4b font string.
    const plain = makeClip({ id: 'c-plain', trackId: 'tt', type: 'text', content: 'x' })
    const scenePlain = resolveTimeline(0, makeProject({ tracks: [track], clips: { tt: [plain] } }))
    expect('fontStyle' in scenePlain.texts[0]).toBe(false)
  })

  it('carries a glyph fill through BY REFERENCE, and adds no key without one (PV-P4c-1)', () => {
    const track = makeTrack({ id: 'tt', kind: 'elements' })
    const textFill: Paint = { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] }
    const clip = makeClip({ id: 'c-fill', trackId: 'tt', type: 'text', content: 'grad', textFill })
    const scene = resolveTimeline(0, makeProject({ tracks: [track], clips: { tt: [clip] } }))

    // `toBe`, not `toEqual`: a gradient is an OBJECT, and a deep copy would hide
    // the one thing that matters about it — the painter mutates nothing but reads
    // the caller's stops, so a resolver that cloned them would be a silent
    // behaviour change nobody could see in a value assertion.
    expect(scene.texts[0].textFill).toBe(textFill)

    const plain = makeClip({ id: 'c-plain', trackId: 'tt', type: 'text', content: 'x' })
    const scenePlain = resolveTimeline(0, makeProject({ tracks: [track], clips: { tt: [plain] } }))
    expect('textFill' in scenePlain.texts[0]).toBe(false)
  })

  it('carries spans by reference, and an EMPTY array adds no key (PV-P4c-2)', () => {
    const track = makeTrack({ id: 'tt', kind: 'elements' })
    // `toBe`: the layout flattens the caller's spans per character and must not be
    // handed a clone, exactly as with `textFill`.
    const spans: TextSpan[] = [{ start: 0, end: 4, fontWeight: 700 }]
    const clip = makeClip({ id: 'c-spans', trackId: 'tt', type: 'text', content: 'Hello world', spans })
    const scene = resolveTimeline(0, makeProject({ tracks: [track], clips: { tt: [clip] } }))
    expect(scene.texts[0].spans).toBe(spans)

    // An EMPTY array is the "all styling cleared" state and must resolve exactly
    // like a clip that never had spans: the spread tests `.length`, not truthiness,
    // so `spans: []` adds no key either.
    for (const empty of [[] as TextSpan[], undefined]) {
      const c = makeClip({ id: 'c-e', trackId: 'tt', type: 'text', content: 'Hello', spans: empty })
      const s = resolveTimeline(0, makeProject({ tracks: [track], clips: { tt: [c] } }))
      expect('spans' in s.texts[0]).toBe(false)
    }
  })

  it('image clips follow video solo rules', () => {
    const trackVid = makeTrack({ id: 'tVid', kind: 'video', order: 0, solo: true })
    const trackImg = makeTrack({ id: 'tImg', kind: 'video', order: 1, solo: false })
    const videoClip = makeClip({ id: 'cVid', trackId: 'tVid', type: 'video', src: 'v.mp4' })
    const imageClip = makeClip({ id: 'cImg', trackId: 'tImg', type: 'image', src: 'img.png' })

    const projectWithSolo = makeProject({
      tracks: [trackVid, trackImg],
      clips: { tVid: [videoClip], tImg: [imageClip] },
    })
    expect(resolveTimeline(0, projectWithSolo).images.length).toBe(0)

    const trackVidNoSolo = makeTrack({ id: 'tVid', kind: 'video', order: 0, solo: false })
    const projectNoSolo = makeProject({
      tracks: [trackVidNoSolo, trackImg],
      clips: { tVid: [videoClip], tImg: [imageClip] },
    })
    const scene = resolveTimeline(0, projectNoSolo)
    expect(scene.images.length).toBe(1)
    expect(scene.images[0].src).toBe('img.png')
    expect(typeof scene.images[0].sourceFrame).toBe('number')
  })

  it('drops video and audio clips when src is an empty string', () => {
    const videoTrack = makeTrack({ id: 'tv', kind: 'video' })
    const videoClip = makeClip({ id: 'cv', trackId: 'tv', type: 'video', src: '' })
    const sceneVideo = resolveTimeline(0, makeProject({ tracks: [videoTrack], clips: { tv: [videoClip] } }))
    expect(sceneVideo.videos.length).toBe(0)

    const audioTrack = makeTrack({ id: 'ta', kind: 'audio' })
    const audioClip = makeClip({ id: 'ca', trackId: 'ta', type: 'audio', src: '' })
    const sceneAudio = resolveTimeline(0, makeProject({ tracks: [audioTrack], clips: { ta: [audioClip] } }))
    expect(sceneAudio.audios.length).toBe(0)
  })

  it('handles a track with no clips entry without throwing', () => {
    const track = makeTrack({ id: 't-orphan', kind: 'video' })
    const project = makeProject({ tracks: [track], clips: {} })
    const scene = resolveTimeline(0, project)

    expect(scene.videos.length).toBe(0)
    expect(scene.audios.length).toBe(0)
    expect(scene.texts.length).toBe(0)
    expect(scene.images.length).toBe(0)
  })

  it('passes Clip.transform through to ActiveClipBase.transform', () => {
    const transform = {
      x: 0.5, y: 0.5, scale: 1.5, rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
    }
    const project = makeProject({
      tracks: [makeTrack()],
      clips: { t1: [makeClip({ transform })] },
    })
    const scene = resolveTimeline(0, project)
    expect(scene.videos[0].transform).toEqual(transform)
  })

  it('still excludes a disabled clip even when its track is solo', () => {
    const track = makeTrack({ id: 'ts', kind: 'video', solo: true })
    const activeClip = makeClip({ id: 'c-on', trackId: 'ts', type: 'video', src: 'a.mp4', startFrame: 0, durationFrames: 30 })
    const disabledClip = makeClip({ id: 'c-off', trackId: 'ts', type: 'video', src: 'b.mp4', startFrame: 0, durationFrames: 30, disabled: true })
    const project = makeProject({ tracks: [track], clips: { ts: [activeClip, disabledClip] } })

    const scene = resolveTimeline(0, project)
    expect(scene.videos.length).toBe(1)
    expect(scene.videos[0].id).toBe('c-on')
  })
})

describe('resolveTimeline — merged A/V clips (embeddedAudio)', () => {
  const merged = (over?: Partial<Clip>) =>
    makeClip({ id: 'm1', trackId: 'v1', type: 'video', src: 'movie.mp4', embeddedAudio: true, ...over })
  const project = (clips: Clip[], tracks: Track[] = [makeTrack({ id: 'v1', kind: 'video' })]) =>
    makeProject({ tracks, clips: { [tracks[0].id]: clips } })

  it('emits exactly one video and one audio entry, the audio under the synthetic id', () => {
    const scene = resolveTimeline(5, project([merged({ sourceStartFrame: 10, volume: 0.6, speed: 2 })]))
    expect(scene.videos).toHaveLength(1)
    expect(scene.audios).toHaveLength(1)
    const a = scene.audios[0]
    expect(a.id).toBe('m1#audio')
    expect(embeddedAudioId('m1')).toBe('m1#audio')
    expect(clipIdOfSceneAudio(a.id)).toBe('m1')
    expect(a.type).toBe('audio')
    expect(a.trackId).toBe('v1')
    expect(a.src).toBe('movie.mp4')
    // The twin shares the picture's resolved source frame and volume.
    expect(a.sourceFrame).toBe(scene.videos[0].sourceFrame)
    expect(a.volume).toBeCloseTo(0.6)
    expect(a.speed).toBe(2)
  })

  it('emits no audio when the flag is absent or false', () => {
    expect(resolveTimeline(5, project([merged({ embeddedAudio: undefined })])).audios).toHaveLength(0)
    expect(resolveTimeline(5, project([merged({ embeddedAudio: false })])).audios).toHaveLength(0)
    expect(resolveTimeline(5, project([merged({ embeddedAudio: false })])).videos).toHaveLength(1)
  })

  it('never emits a twin for a non-video clip', () => {
    const img = makeClip({ id: 'i1', trackId: 'v1', type: 'image', src: 'a.png', embeddedAudio: true })
    expect(resolveTimeline(5, project([img])).audios).toHaveLength(0)
  })

  it('a legacy video + separate audio pair still has exactly one audio entry', () => {
    const tracks = [makeTrack({ id: 'v1', kind: 'video' }), makeTrack({ id: 'a1', kind: 'audio', order: 1 })]
    const p = makeProject({
      tracks,
      clips: {
        v1: [makeClip({ id: 'v', trackId: 'v1', src: 'movie.mp4' })],
        a1: [makeClip({ id: 'a', trackId: 'a1', type: 'audio', src: 'movie.mp4' })],
      },
    })
    expect(resolveTimeline(5, p).audios.map((x) => x.id)).toEqual(['a'])
  })

  it('track mute zeroes the twin and track volume folds in', () => {
    const muted = project([merged()], [makeTrack({ id: 'v1', kind: 'video', muted: true })])
    expect(resolveTimeline(5, muted).audios[0].volume).toBe(0)
    const half = project([merged({ volume: 0.8 })], [makeTrack({ id: 'v1', kind: 'video', volume: 0.5 })])
    expect(resolveTimeline(5, half).audios[0].volume).toBeCloseTo(0.4)
  })

  it('a disabled clip or track emits no sound', () => {
    expect(resolveTimeline(5, project([merged({ disabled: true })])).audios).toHaveLength(0)
    expect(resolveTimeline(5, project([merged()], [makeTrack({ id: 'v1', kind: 'video', disabled: true })])).audios).toHaveLength(0)
  })

  it('soloing an audio lane silences the merged clip’s sound but not its picture', () => {
    const tracks = [
      makeTrack({ id: 'v1', kind: 'video', order: 0 }),
      makeTrack({ id: 'a1', kind: 'audio', order: 1, solo: true }),
    ]
    const p = makeProject({
      tracks,
      clips: { v1: [merged()], a1: [makeClip({ id: 'a', trackId: 'a1', type: 'audio', src: 'm.mp3' })] },
    })
    const scene = resolveTimeline(5, p)
    expect(scene.videos.map((v) => v.id)).toEqual(['m1'])
    expect(scene.audios.map((x) => x.id)).toEqual(['a'])
  })

  it('soloing the merged video lane keeps its sound and does not mute a plain audio lane', () => {
    const tracks = [
      makeTrack({ id: 'v1', kind: 'video', order: 0, solo: true }),
      makeTrack({ id: 'a1', kind: 'audio', order: 1 }),
    ]
    const p = makeProject({
      tracks,
      clips: { v1: [merged()], a1: [makeClip({ id: 'a', trackId: 'a1', type: 'audio', src: 'm.mp3' })] },
    })
    expect(resolveTimeline(5, p).audios.map((x) => x.id).sort()).toEqual(['a', 'm1#audio'])
  })

  it('a solo on another video lane silences this lane’s sound along with its picture', () => {
    const tracks = [
      makeTrack({ id: 'v1', kind: 'video', order: 0 }),
      makeTrack({ id: 'v2', kind: 'video', order: 1, solo: true }),
    ]
    const p = makeProject({
      tracks,
      clips: { v1: [merged()], v2: [merged({ id: 'm2', trackId: 'v2' })] },
    })
    const scene = resolveTimeline(5, p)
    expect(scene.audios.map((x) => x.id)).toEqual(['m2#audio'])
  })

  it('a transition does NOT zero the twin: each clip’s sound runs to its own boundary', () => {
    const a = merged({ id: 'a', startFrame: 0, durationFrames: 30 })
    const b = merged({ id: 'b', startFrame: 30, durationFrames: 30 })
    const p = project([a, b])
    p.transitions = [
      { id: 'tr', kind: 'fade', trackId: 'v1', fromClipId: 'a', toClipId: 'b', startFrame: 20, durationFrames: 20 },
    ]
    // Frame 25: the outgoing clip is mid-transition; the incoming has not started.
    const early = resolveTimeline(25, p)
    expect(early.videos.map((v) => v.id).sort()).toEqual(['a', 'b'])
    expect(early.audios.map((x) => x.id)).toEqual(['a#audio'])
    expect(early.audios[0].volume).toBe(1)
    // Frame 35: the outgoing clip has ended (picture held by the transition), the incoming sounds.
    const late = resolveTimeline(35, p)
    expect(late.videos.map((v) => v.id).sort()).toEqual(['a', 'b'])
    expect(late.audios.map((x) => x.id)).toEqual(['b#audio'])
    expect(late.audios[0].volume).toBe(1)
  })

  it('a time-remapped merged clip emits no audio', () => {
    const remapped = merged({
      keyframes: {
        channels: {
          time: {
            source: { kind: 'keyframes' },
            keys: [
              { frame: 0, value: 0, easing: 'linear' },
              { frame: 29, value: 29, easing: 'linear' },
            ],
          },
        },
      } as Clip['keyframes'],
    })
    const scene = resolveTimeline(5, project([remapped]))
    expect(scene.videos).toHaveLength(1)
    expect(scene.audios).toHaveLength(0)
  })

  it('plain audio clips carry speed only when it is not 1', () => {
    const tracks = [makeTrack({ id: 'a1', kind: 'audio' })]
    const clip = (speed?: number) => makeClip({ id: 'a', trackId: 'a1', type: 'audio', src: 'a.mp3', speed })
    const at = (speed?: number) => resolveTimeline(5, makeProject({ tracks, clips: { a1: [clip(speed)] } })).audios[0]
    expect(at(undefined)).not.toHaveProperty('speed')
    expect(at(1)).not.toHaveProperty('speed')
    expect(at(1.5).speed).toBe(1.5)
  })
})
