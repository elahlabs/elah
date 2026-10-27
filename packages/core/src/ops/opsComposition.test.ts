import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { sanitizeOps } from './sanitize'
import { applyOps } from './apply'
import { opDescriber } from './describeOp'
import type { EditorOp } from './types'

/** Reuses `ops.test.ts`'s fixture shape (`a` an image, `b` a video), plus a
 *  text clip `t` on an elements track for composition bindings to target. */
function fixture() {
  const engine = new TimelineEngine({ fps: 30, stage: { width: 1920, height: 1080 } })
  const v = engine.addTrack('video').id
  const a = engine.addClip({ trackId: v, type: 'image', name: 'Interview', src: 'a.png', startFrame: 0, durationFrames: 150 })
  const b = engine.addClip({ trackId: v, type: 'video', name: 'B-roll', src: 'b.mp4', startFrame: 150, durationFrames: 150 })
  const e = engine.addTrack('elements').id
  const t = engine.addClip({ trackId: e, type: 'text', name: 'Title', text: { content: 'Hello' }, startFrame: 0, durationFrames: 60 })
  return { engine, v, e, a: a.id, b: b.id, t: t.id }
}

describe('sanitizeOps — addComposition / setProp (PV-P7c)', () => {
  it('accepts the strict-schema form', () => {
    const { engine, t } = fixture()
    const { ops, dropped } = sanitizeOps(
      [
        {
          op: 'addComposition',
          props: [
            { name: 'title', type: 'text', label: null, default: 'Hi', min: null, max: null, options: null },
            { name: 'mood', type: 'enum', label: 'Mood', default: 'calm', min: null, max: null, options: ['calm', 'bold'] },
          ],
          bindings: [{ clip: t, path: 'text', prop: 'title', template: null }],
        },
      ],
      engine.getProject(),
    )
    expect(dropped).toEqual([])
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({
      op: 'addComposition',
      props: [
        { name: 'title', type: 'text', label: 'title', default: 'Hi' },
        { name: 'mood', type: 'enum', label: 'Mood', default: 'calm', options: ['calm', 'bold'] },
      ],
      bindings: [{ clip: t, path: 'text', prop: 'title' }],
    })
  })

  it('drops an invalid prop or binding silently, keeping the rest of the op', () => {
    const { engine, t } = fixture()
    const { ops, dropped } = sanitizeOps(
      [
        {
          op: 'addComposition',
          props: [
            { name: 'title', type: 'text', default: 'Hi' },
            { name: 'bad name', type: 'text', default: 'x' }, // invalid identifier
            { name: 'vec', type: 'vector', default: '1,2' }, // unknown type
            { name: 'noOptions', type: 'enum', default: 'a' }, // enum with no options
          ],
          bindings: [
            { clip: t, path: 'text', prop: 'title' },
            { clip: 'nope', path: 'text', prop: 'title' }, // no such clip
            { clip: t, path: 'startFrame', prop: 'title' }, // structural field
            { clip: t, path: 'text', prop: 'undeclared' }, // undeclared prop
          ],
        },
      ],
      engine.getProject(),
    )
    expect(dropped).toEqual([])
    expect(ops).toHaveLength(1)
    const op = ops[0] as Extract<EditorOp, { op: 'addComposition' }>
    expect(op.props.map((p) => p.name)).toEqual(['title'])
    expect(op.bindings).toEqual([{ clip: t, path: 'text', prop: 'title' }])
  })

  it('drops the whole op when nothing in it is valid', () => {
    const { engine } = fixture()
    const { ops, dropped } = sanitizeOps(
      [{ op: 'addComposition', props: [{ name: 'bad name', type: 'text', default: 'x' }], bindings: [{ clip: 'nope', path: 'text', prop: 'title' }] }],
      engine.getProject(),
    )
    expect(ops).toEqual([])
    expect(dropped).toHaveLength(1)
    expect(dropped[0]!.reason).toMatch(/needs props or bindings/)
  })

  it('setProp for an undeclared name is dropped; accepted after the same plan’s addComposition, and its value is coerced', () => {
    const { engine } = fixture()
    const { ops: aloneOps, dropped: aloneDropped } = sanitizeOps([{ op: 'setProp', name: 'title', value: '0.5' }], engine.getProject())
    expect(aloneOps).toEqual([])
    expect(aloneDropped[0]!.reason).toMatch(/no prop "title"/)

    const { ops, dropped } = sanitizeOps(
      [
        { op: 'addComposition', props: [{ name: 'title', type: 'number', default: 0 }], bindings: [] },
        { op: 'setProp', name: 'title', value: '0.5' },
      ],
      engine.getProject(),
    )
    expect(dropped).toEqual([])
    expect(ops[1]).toEqual({ op: 'setProp', name: 'title', value: 0.5 })
  })

  it('a $ref binding is accepted for a clip created earlier in the same plan', () => {
    const { engine } = fixture()
    const { ops, dropped } = sanitizeOps(
      [
        { op: 'addText', ref: 'h', text: 'Hey', at: 0, duration: 2 },
        {
          op: 'addComposition',
          props: [{ name: 'title', type: 'text', default: 'Hey' }],
          bindings: [{ clip: '$h', path: 'text', prop: 'title' }],
        },
      ],
      engine.getProject(),
    )
    expect(dropped).toEqual([])
    expect(ops).toHaveLength(2)
    expect((ops[1] as Extract<EditorOp, { op: 'addComposition' }>).bindings).toEqual([{ clip: '$h', path: 'text', prop: 'title' }])
  })
})

describe('applyOps — addComposition / setProp (PV-P7c)', () => {
  it('declares a prop bound to a clip, then setProp rewrites it as one undo step', () => {
    const { engine, t } = fixture()
    const before = engine.getProject()
    const ops: EditorOp[] = [
      { op: 'addComposition', props: [{ name: 'title', type: 'text', default: 'Hello', label: 'Title' }], bindings: [{ clip: t, path: 'text', prop: 'title' }] },
      { op: 'setProp', name: 'title', value: 'Launch' },
    ]

    const res = applyOps(engine, ops)

    expect(res.applied).toEqual([0, 1])
    expect(res.skipped).toEqual([])
    expect(engine.findClip(t)!.clip.content).toBe('Launch')
    expect(engine.getProject().composition?.values?.title).toBe('Launch')
    expect(res.touched.changed).toContain(t)
    expect(res.range).not.toBeNull()
    expect(res.range!.startFrame).toBeLessThanOrEqual(0)
    expect(res.range!.endFrame).toBeGreaterThanOrEqual(60)

    engine.undo()
    expect(engine.getProject()).toBe(before)
    expect(engine.getProject().composition).toBeUndefined()
  })

  it('skips a setProp with an invalid value; the rest of the plan still applies', () => {
    const { engine, t } = fixture()
    const ops: EditorOp[] = [
      { op: 'addComposition', props: [{ name: 'accent', type: 'color', default: '#3366ff', label: 'Accent' }], bindings: [] },
      { op: 'setProp', name: 'accent', value: 'not-a-color' },
      { op: 'addMarker', at: 1, name: 'Beat' },
    ]

    const res = applyOps(engine, ops)

    expect(res.applied).toEqual([0, 2])
    expect(res.skipped).toHaveLength(1)
    expect(res.skipped[0]!.reason).toMatch(/colour|cannot take that value/)
    expect(engine.getProject().markers?.length ?? 0).toBe(1)
    void t
  })

  it('resolves a $ref binding to the newly created clip’s id', () => {
    const { engine } = fixture()
    const ops: EditorOp[] = [
      { op: 'addText', ref: 'h', text: 'Hey', at: 0, duration: 2 },
      {
        op: 'addComposition',
        props: [{ name: 'title', type: 'text', default: 'Hey', label: 'Title' }],
        bindings: [{ clip: '$h', path: 'text', prop: 'title' }],
      },
    ]
    const res = applyOps(engine, ops)
    expect(res.skipped).toEqual([])
    const newId = res.refs.h!
    expect(engine.getProject().composition?.bindings[0]?.clipId).toBe(newId)
  })

  it('addComposition with an existing prop name replaces that prop; props length unchanged', () => {
    const { engine } = fixture()
    applyOps(engine, [{ op: 'addComposition', props: [{ name: 'title', type: 'text', default: 'Hi', label: 'Title' }], bindings: [] }])
    const before = engine.getProject().composition!.props.length

    const res = applyOps(engine, [{ op: 'addComposition', props: [{ name: 'title', type: 'text', default: 'Bye', label: 'Title' }], bindings: [] }])

    expect(res.skipped).toEqual([])
    expect(engine.getProject().composition!.props).toHaveLength(before)
    expect(engine.getProject().composition!.props.find((p) => p.name === 'title')?.default).toBe('Bye')
  })
})

describe('opDescriber — addComposition / setProp (PV-P7c)', () => {
  it('describes both ops as plain sentences', () => {
    const { engine } = fixture()
    const say = opDescriber(engine.getProject())
    expect(
      say({
        op: 'addComposition',
        props: [
          { name: 'title', type: 'text', default: 'Hi', label: 'title' },
          { name: 'mood', type: 'enum', default: 'calm', label: 'mood', options: ['calm', 'bold'] },
        ],
        bindings: [{ clip: 'x', path: 'text', prop: 'title' }],
      }),
    ).toBe('Make 2 props (title, mood) and bind 1 field')
    expect(say({ op: 'setProp', name: 'title', value: 'Launch' })).toBe('Set prop “title” to “Launch”')
    expect(say({ op: 'setProp', name: 'size', value: 3 })).toBe('Set prop “size” to 3')
  })
})
