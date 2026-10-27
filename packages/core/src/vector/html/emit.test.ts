import { describe, it, expect } from 'vitest'
import type { Clip, Project } from '../../types'
import { emitScene, textSlack } from './emit'
import { computeTextLayout } from '../../renderer/gpu/layers/textLayout'
import { statScene, lowerThirdScene, titleScene, cardScene, logoScene, barScene, twoPathScene } from './fixtures'
import { resolveShapeRect } from '../../renderer/gpu/layers/shapePaint'
import type { MeasuredNode, MeasuredScene } from './types'

const FPS = 30

/** A compound's layers bottom to top. */
function layers(clip: Clip): Clip[] {
  const project = clip.compound?.project as Project
  return [...project.tracks]
    .sort((a, b) => a.order - b.order)
    .flatMap((t) => project.clips[t.id] ?? [])
}

function named(clip: Clip, name: string): Clip {
  const found = layers(clip).find((c) => c.name === name)
  if (!found) throw new Error(`no layer ${name} in ${layers(clip).map((c) => c.name).join(', ')}`)
  return found
}

const emit = (scene: MeasuredScene) => emitScene(scene, { fps: FPS })

describe('the scene compound', () => {
  it('is one compound starting at round(at x fps) lasting round(duration x fps)', () => {
    const { clip } = emit(statScene())
    expect(clip.type).toBe('compound')
    expect(clip.name).toBe('stat')
    expect(clip.startFrame).toBe(360)
    expect(clip.durationFrames).toBe(120)
    expect((clip.compound?.project as Project).stage).toEqual({ width: 1080, height: 1920 })
    for (const c of layers(clip)) {
      expect(c.startFrame).toBe(0)
      expect(c.durationFrames).toBe(120)
    }
  })

  it('rounds fractional times to frames', () => {
    const scene = statScene()
    scene.at = 1.51
    scene.duration = 0.34
    const { clip } = emit(scene)
    expect(clip.startFrame).toBe(45)
    expect(clip.durationFrames).toBe(10)
  })
})

describe('stat scene (plan 4.5)', () => {
  it('has the ring as a path shape and the column as a nested compound of two text clips', () => {
    const { clip, report } = emit(statScene())
    const top = layers(clip)
    expect(top.map((c) => [c.name, c.type])).toEqual([
      ['ring', 'shape'],
      ['big-group', 'compound'],
    ])
    expect(top[0].shapeKind).toBe('path')
    const column = layers(top[1])
    expect(column.map((c) => [c.name, c.type])).toEqual([
      ['big', 'text'],
      ['label', 'text'],
    ])
    // ring (1) + column compound (1) + 2 texts
    expect(report.native).toBe(4)
    expect(report.parts.map((p) => p.name)).toEqual(['ring', 'big', 'label'])
    // Nested parts are addressed through their compound's id.
    const [ring, big, label] = report.parts
    expect(ring.id).toBe(top[0].id)
    expect(big.id).toBe(`${top[1].id}/${column[0].id}`)
    expect(label.id).toBe(`${top[1].id}/${column[1].id}`)
  })

  it('keeps the measured line breaks and box width on a text clip', () => {
    const { clip } = emit(statScene())
    const label = named(layers(clip)[1], 'label')
    expect(label.content).toBe('of attacks start on\nfree Wi-Fi')
    expect(label.textBox?.width).toBeCloseTo(520 + textSlack(520), 6)
    expect(label.textBox?.overflow).toBe('wrap')
    expect(label.fontSize).toBe(44)
    expect(label.fontId).toBe('inter')
    expect(label.color).toBe('#9aa4b2')
    expect(label.textBox?.lineHeight).toBeCloseTo(53 / 44, 6)
    const big = named(layers(clip)[1], 'big')
    expect(big.fontId).toBe('bebas-neue')
    expect(big.textBox?.lineHeight).toBeCloseTo(0.9, 6)
    expect(big.content).toBe('72%')
  })

  it('places text and shapes at their box centres as stage fractions', () => {
    const { clip } = emit(statScene())
    const ring = layers(clip)[0]
    expect(ring.transform?.x).toBeCloseTo((46 + 210) / 1080, 6)
    expect(ring.transform?.y).toBeCloseTo((750 + 210) / 1920, 6)
    const column = layers(clip)[1]
    // The nested compound's own stage is its box, its centre is placed in the scene.
    expect((column.compound?.project as Project).stage).toEqual({ width: 520, height: 316 })
    expect(column.transform?.x).toBeCloseTo((514 + 260) / 1080, 6)
    const big = named(column, 'big')
    expect(big.transform?.x).toBeCloseTo(0.5, 6)
    expect(big.transform?.y).toBeCloseTo(99 / 316, 6)
  })

  it('draws the ring stroke scaled from the svg viewBox into its box', () => {
    const { clip } = emit(statScene())
    const ring = layers(clip)[0]
    // viewBox 100 -> 420 px box: stroke 8 * 4.2; the circle spans 88 units = 369.6 px.
    expect(ring.shapeStrokeWidth).toBeCloseTo(8 * 4.2, 3)
    const short = 1080
    const side = (ring.transform?.scale ?? 0) * short
    expect(Math.max(side * (ring.transform?.scaleX ?? 1), side * (ring.transform?.scaleY ?? 1))).toBeGreaterThan(369)
  })
})

describe('lower third', () => {
  it('is a pill compound holding a name and a title; the pill is a rect with a corner radius fraction', () => {
    const { clip } = emit(lowerThirdScene())
    const [pill] = layers(clip)
    expect(pill.type).toBe('compound')
    expect(pill.name).toBe('pill')
    expect(pill.opacity).toBe(0.9)
    const inner = layers(pill)
    expect(inner.map((c) => [c.name, c.type])).toEqual([
      ['pill-bg', 'shape'],
      ['name', 'text'],
      ['title', 'text'],
    ])
    const bg = inner[0]
    expect(bg.shapeKind).toBe('rect')
    expect(bg.shapeFill).toBe('rgb(17, 24, 39)')
    // 24 px on a 160 px short side.
    expect(bg.cornerRadius).toBeCloseTo(24 / 160, 6)
    expect(inner[1].fontWeight).toBe(700)
  })
})

describe('title scene', () => {
  it('breaks lines as measured, centres, and carries shadow, outline and tracking', () => {
    const { clip } = emit(titleScene())
    const headline = named(clip, 'headline')
    expect(headline.content).toBe('Make something\npeople')
    expect(headline.textBox?.width).toBeCloseTo(1440 + textSlack(1440), 6)
    expect(headline.textAlign).toBe('center')
    expect(headline.textShadow).toEqual({ color: 'rgba(0, 0, 0, 0.5)', offsetX: 0, offsetY: 6, blur: 12 })
    expect(headline.textOutline).toEqual({ color: '#ff3d7f', width: 2 })
    expect(headline.fontId).toBe('playfair-display')
  })

  it('turns a background-clip:text gradient into textFill using the gradient parser', () => {
    const { clip } = emit(titleScene())
    const word = named(clip, 'word')
    expect(word.textFill).toEqual({
      type: 'linear',
      angle: 0,
      stops: [
        { offset: 0, color: '#ff3d7f' },
        { offset: 1, color: '#ffd166' },
      ],
    })
  })

  it('gives a text node its own box fields instead of a shape, and snaps weight and substitutes the font', () => {
    const { clip, report } = emit(titleScene())
    const tag = named(clip, 'tag')
    expect(tag.type).toBe('text')
    expect(tag.backgroundColor).toBe('#ffd166')
    expect(tag.padding).toBe(12)
    expect(tag.borderRadius).toBe(30)
    expect(tag.textBox?.width).toBe(240 - 24)
    expect(tag.textBox?.letterSpacing).toBe(2)
    // Comic Sans is not bundled: nearest by role, reported, weight 600 snapped to a shipped weight.
    expect(tag.fontId).toBe('inter')
    expect(tag.fontWeight).toBe(700)
    expect(report.substitutions).toEqual([{ feature: 'font:Comic Sans MS', used: 'inter' }])
  })
})

describe('card scene', () => {
  it('masks an overflow:hidden parent with its rounded box and a rounded image with its own path mask', () => {
    const { clip } = emit(cardScene())
    const [card] = layers(clip)
    expect(card.name).toBe('card')
    expect(card.mask?.kind).toBe('path')
    expect(card.mask?.viewBox).toEqual({ x: 0, y: 0, width: 600, height: 700 })
    const inner = layers(card)
    // Background rect (with the 4 px border), then the zIndex-sorted children: photo, caption, badge on top.
    expect(inner.map((c) => c.name)).toEqual(['card-bg', 'photo', 'caption', 'badge'])
    const bg = inner[0]
    expect(bg.shapeStroke).toBe('#222222')
    expect(bg.shapeStrokeWidth).toBe(4)
    expect(bg.cornerRadius).toBeCloseTo(32 / 600, 6)
    const photo = inner[1]
    expect(photo.type).toBe('image')
    expect(photo.src).toBe('elah-asset:photo-1')
    expect(photo.mask?.kind).toBe('path')
    // object-fit: cover on a 2:1 image in a 3:2 box: the image is wider than the box, the mask is the box part.
    expect(photo.mask?.width).toBeCloseTo(600 / 800, 6)
  })

  it('turns circle() into an ellipse mask over the box', () => {
    const { clip } = emit(cardScene())
    const badge = named(layers(clip)[0], 'badge')
    expect(badge.mask).toEqual({ kind: 'ellipse', x: 0, y: 0, width: 1, height: 1 })
  })

  it('orders siblings by z-index, later on top, ties by document order', () => {
    const scene = cardScene()
    const card = scene.root.children[0]
    // Put the badge first in the document with zIndex 2 and the caption with zIndex 1: badge still on top.
    const [photo, caption, badge] = card.children
    card.children = [badge, caption, photo]
    caption.style.zIndex = 1
    const { clip } = emit(scene)
    expect(layers(layers(clip)[0]).map((c) => c.name)).toEqual(['card-bg', 'photo', 'caption', 'badge'])
  })
})

describe('logo scene', () => {
  it('imports inline svg as a compound of shapes, placed in the box with the static pose and blend', () => {
    const { clip, report } = emit(logoScene())
    const layersTop = layers(clip)
    expect(layersTop.map((c) => c.name)).toEqual(['root-bg', 'mark', 'wordmark'])
    const mark = layersTop[1]
    expect(mark.type).toBe('compound')
    expect(Object.values((mark.compound?.project as Project).clips).flat().length).toBe(2)
    expect(mark.blend).toBe('screen')
    expect(mark.transform?.rotation).toBeCloseTo((15 * Math.PI) / 180, 6)
    // 100 unit viewBox (1024 px child stage) drawn into a 200 px box, then scale 1.5.
    expect(mark.transform?.scale).toBeCloseTo((200 / 1024) * 1.5, 6)
    expect(mark.transform?.x).toBeCloseTo(0.5, 6)
    // color-dodge is not one of the nine engine modes.
    expect(report.skipped).toContainEqual({ feature: 'mix-blend-mode:color-dodge', count: 1 })
    expect(layersTop[2].blend).toBeUndefined()
  })
})

describe('report', () => {
  it('counts skipped features and survives an unreadable gradient', () => {
    const scene = lowerThirdScene()
    const pill = scene.root.children[0]
    pill.style.backgroundImage = 'repeating-linear-gradient(red, blue 10px)'
    pill.style.backgroundColor = undefined
    const { report, clip } = emit(scene)
    expect(report.skipped).toContainEqual({ feature: 'unreadable-gradient', count: 1 })
    expect(layers(layers(clip)[0])[0].shapeFillPaint).toBeUndefined()
  })

  it('reports a bad data-motion clause against the element and still emits the scene', () => {
    const scene = statScene()
    const col = scene.root.children[1]
    col.children[0].motion = 'opacty: 0 → 1 1s; in: fade-in 0.3s'
    const { clip, report } = emit(scene)
    expect(report.violations).toHaveLength(1)
    expect(report.violations?.[0]).toMatchObject({ element: 'big', substitute: 'opacity' })
    const big = named(layers(clip)[1], 'big')
    expect(big.keyframes?.channels.opacity?.keys.length).toBe(2)
  })

  it('emits nothing for an empty box and never throws on a bare scene', () => {
    const empty: MeasuredNode = { tag: 'section', box: { x: 0, y: 0, width: 100, height: 100 }, style: {}, children: [] }
    const { clip, report } = emit({ name: 'e', at: 0, duration: 1, stage: { width: 100, height: 100 }, root: empty })
    expect(layers(clip)).toEqual([])
    expect(report.native).toBe(0)
  })

  it('flattens containers past the compound depth cap and says so', () => {
    const leaf = (id: string): MeasuredNode => ({ tag: 'p', id, box: { x: 0, y: 0, width: 10, height: 10 }, style: { color: '#fff', fontSize: 10 }, text: { lines: [{ text: id, box: { x: 0, y: 0, width: 10, height: 10 } }] }, children: [] })
    const wrap = (id: string, kids: MeasuredNode[]): MeasuredNode => ({ tag: 'div', id, box: { x: 0, y: 0, width: 50, height: 50 }, style: { backgroundColor: '#123456' }, children: kids })
    const deep = wrap('a', [wrap('b', [wrap('c', [wrap('d', [leaf('t1'), leaf('t2')]), leaf('t3')]), leaf('t4')]), leaf('t5')])
    const { clip, report } = emit({ name: 'deep', at: 0, duration: 1, stage: { width: 100, height: 100 }, root: { ...wrap('root', [deep]), box: { x: 0, y: 0, width: 100, height: 100 }, style: {} } })
    expect(report.skipped.some((s) => s.feature === 'nesting-depth')).toBe(true)
    let depth = 0
    let level: Clip[] = layers(clip)
    while (level.some((c) => c.type === 'compound')) {
      depth++
      level = level.filter((c) => c.type === 'compound').flatMap(layers)
    }
    expect(depth).toBeLessThanOrEqual(3)
  })
})

describe('MC-1e: svg placed by its viewBox', () => {
  it('a 664 x 8 viewBox with a horizontal stroke emits a clip spanning the 664 x 8 box, stroke 8 wide', () => {
    const { clip } = emit(barScene())
    const bar = layers(clip)[0]
    expect(bar.type).toBe('shape')
    const rect = resolveShapeRect(bar.transform, { width: 1080, height: 1920 })
    expect(rect.width).toBeGreaterThan(663)
    expect(rect.width).toBeLessThan(665)
    expect(rect.height).toBeGreaterThan(7)
    expect(rect.height).toBeLessThan(9)
    expect(rect.x + rect.width / 2).toBeCloseTo(120 + 332, 0)
    expect(rect.y + rect.height / 2).toBeCloseTo(904, 0)
    expect(bar.shapeStrokeWidth).toBeCloseTo(8, 0)
    // The path is drawn in the viewBox's own frame, so the stroke is not clipped to the path bounds.
    expect(bar.shapeViewBox).toMatchObject({ x: 0, y: 0 })
  })

  it('letterboxes (meet) a viewBox into a box of another aspect', () => {
    const scene = barScene()
    const wrap = scene.root.children[0]
    wrap.box = { x: 100, y: 100, width: 664, height: 80 }
    wrap.children[0].box = { x: 100, y: 100, width: 664, height: 80 }
    const bar = layers(emit(scene).clip)[0]
    const rect = resolveShapeRect(bar.transform, { width: 1080, height: 1920 })
    // scale = min(664/664, 80/8) = 1: the art stays 664 x 8 and sits in the middle of the box.
    expect(rect.width).toBeCloseTo(664, 0)
    expect(rect.height).toBeCloseTo(8, 0)
    expect(rect.y + rect.height / 2).toBeCloseTo(140, 0)
  })
})

describe('MC-1e: shape-only channels on a wrapper', () => {
  it('a draw written on a div whose svg is one path keys that path', () => {
    const { clip } = emit(barScene())
    const bar = layers(clip)[0]
    expect(bar.keyframes?.channels.draw?.keys.length).toBe(2)
  })

  it('draw on a wrapper around a two-path svg is applied to each path and the rest stays on the wrapper', () => {
    const t = emit(twoPathScene())
    const wrapClip = layers(t.clip)[0]
    expect(wrapClip.type).toBe('compound')
    const kids = layers(wrapClip)
    expect(kids).toHaveLength(2)
    for (const k of kids) expect(k.keyframes?.channels.draw?.keys.length).toBe(2)
    expect(wrapClip.keyframes?.channels.draw).toBeUndefined()
    // The non-shape clause stays on the wrapper.
    expect(wrapClip.keyframes?.channels.opacity?.keys.length).toBeGreaterThan(0)
    expect(t.report.substitutions.some((s) => s.used.includes('draw forwarded to') && s.used.includes(kids[0].name))).toBe(true)
    expect(t.report.violations ?? []).toEqual([])
  })

  it('a compound with exactly one shape child gives it the draw keys', () => {
    const scene = twoPathScene()
    const wrap = scene.root.children[0]
    const svg = wrap.children[0].svg as NonNullable<typeof wrap.svg>
    svg.children = svg.children.slice(0, 1)
    // A text sibling makes the wrapper a real container (compound) with the svg path as its one shape.
    wrap.children = [
      wrap.children[0],
      { tag: 'p', id: 'cap', box: { x: 100, y: 100, width: 50, height: 20 }, style: { color: '#fff', fontSize: 12 }, text: { lines: [{ text: 'hi', box: { x: 100, y: 100, width: 50, height: 20 } }] }, children: [] },
    ]
    const { clip, report } = emit(scene)
    const w = layers(clip)[0]
    expect(w.type).toBe('compound')
    const shape = layers(w).find((c) => c.type === 'shape')
    expect(shape?.keyframes?.channels.draw?.keys.length).toBe(2)
    expect(w.keyframes?.channels.draw).toBeUndefined()
    expect(report.substitutions.some((s) => s.used.includes('draw forwarded to'))).toBe(true)
  })
})

describe('MC-1e: no phantom stroke', () => {
  it('a filled box with no border emits a rect with stroke width 0 and no stroke paint', () => {
    const { clip } = emit(lowerThirdScene())
    const bg = named(layers(clip)[0], 'pill-bg')
    expect(bg.shapeStrokeWidth).toBe(0)
    expect(bg.shapeStroke).toBe('transparent')
    expect(bg.shapeStrokePaint).toBeUndefined()
  })

  it('a box with a real border still strokes it', () => {
    const { clip } = emit(cardScene())
    const bg = named(layers(clip)[0], 'card-bg')
    expect(bg.shapeStrokeWidth).toBe(4)
  })
})

/** A one-line button with its own fill, border-less, `font 44 / lh 52.8`, on a 1080x1920 stage. */
function buttonScene(over: { style?: Partial<MeasuredNode['style']>; box?: { x: number; y: number; width: number; height: number }; id?: string } = {}): MeasuredScene {
  const b = over.box ?? { x: 100, y: 500, width: 520, height: 100.8 }
  const link: MeasuredNode = {
    tag: 'a',
    id: over.id ?? 'link',
    box: b,
    style: {
      color: '#ffd166',
      backgroundColor: 'rgb(13, 17, 23)',
      borderRadius: 24,
      borderRadii: [24, 24, 24, 24],
      padding: 44,
      fontFamily: 'inter, sans-serif',
      fontSize: 44,
      fontWeight: 700,
      lineHeight: 52.8,
      textAlign: 'left',
      ...over.style,
    },
    text: { lines: [{ text: 'elah.dev/start', box: { x: b.x + 44, y: b.y + 24, width: 300, height: 52.8 } }] },
    children: [],
  }
  return { name: 'btn', at: 0, duration: 2, stage: { width: 1080, height: 1920 }, root: { tag: 'section', box: { x: 0, y: 0, width: 1080, height: 1920 }, style: {}, children: [link] } }
}

describe('MC-1f: asymmetric padding on boxed text', () => {
  /** Top-left of a text clip's box inside its compound, given the box size (the transform is its anchor point). */
  const topLeft = (c: Clip, inner: { width: number; height: number }, w: number, h: number) => ({
    x: (c.transform?.x ?? 0) * inner.width - (c.transform?.anchor?.x ?? 0) * w,
    y: (c.transform?.y ?? 0) * inner.height - (c.transform?.anchor?.y ?? 0) * h,
  })
  const rectPx = (c: Clip, inner: { width: number; height: number }) => resolveShapeRect(c.transform, inner)

  it('padding 24/44 (explicit paddings) emits a compound of a rect at the measured box and a text clip at the content box', () => {
    const { clip } = emit(buttonScene({ style: { paddings: [24, 44, 24, 44] } }))
    const link = layers(clip)[0]
    expect(link.type).toBe('compound')
    expect(link.name).toBe('link')
    const inner = layers(link)
    expect(inner.map((c) => [c.name, c.type])).toEqual([
      ['link-bg', 'shape'],
      ['link-text', 'text'],
    ])
    const stage = { width: 520, height: 100.8 }
    const r = rectPx(inner[0], stage)
    expect(r.width).toBeCloseTo(520, 0)
    expect(r.height).toBeCloseTo(100.8, 0)
    expect(inner[0].shapeFill).toBe('rgb(13, 17, 23)')
    expect(inner[0].cornerRadius).toBeCloseTo(24 / 100.8, 6)
    const text = inner[1]
    expect(text.padding).toBeUndefined()
    expect(text.backgroundColor).toBeUndefined()
    expect(text.textBox?.width).toBeCloseTo(520 - 88 + textSlack(520 - 88), 6)
    expect(topLeft(text, stage, 432 + textSlack(432), 52.8).x).toBeCloseTo(44, 6)
    expect(topLeft(text, stage, 432 + textSlack(432), 52.8).y).toBeCloseTo(24, 6)
  })

  it('works the vertical padding out from the box height when no paddings are measured (101 tall, 52.8 line)', () => {
    const { clip } = emit(buttonScene())
    const link = layers(clip)[0]
    expect(link.type).toBe('compound')
    const text = named(link, 'link-text')
    expect(topLeft(text, { width: 520, height: 100.8 }, 432 + textSlack(432), 52.8).y).toBeCloseTo(24, 6)
    expect(topLeft(text, { width: 520, height: 100.8 }, 432 + textSlack(432), 52.8).x).toBeCloseTo(44, 6)
  })

  it('carries the border, per-corner radii and shadow on the rect, and insets the text by the border too', () => {
    const { clip } = emit(
      buttonScene({
        box: { x: 100, y: 500, width: 600, height: 126.8 },
        style: { paddings: [28, 48, 28, 48], borderWidth: 3, borderColor: 'rgb(255, 209, 102)', borderRadii: [10, 20, 30, 40], boxShadow: 'rgba(0, 0, 0, 0.4) 0px 8px 16px 0px' },
      }),
    )
    const link = layers(clip)[0]
    const bg = named(link, 'link-bg')
    expect(bg.shapeStrokeWidth).toBe(3)
    expect(bg.cornerRadii).toEqual([10 / 126.8, 20 / 126.8, 30 / 126.8, 40 / 126.8])
    expect(bg.shadow).toBeDefined()
    const text = named(link, 'link-text')
    expect(topLeft(text, { width: 600, height: 126.8 }, 498 + textSlack(498), 64.8).x).toBeCloseTo(51, 6)
    expect(topLeft(text, { width: 600, height: 126.8 }, 498 + textSlack(498), 64.8).y).toBeCloseTo(31, 6)
  })

  it('equal paddings keep today single text clip with its own box', () => {
    const { clip } = emit(buttonScene({ box: { x: 100, y: 500, width: 520, height: 140.8 }, style: { paddings: [44, 44, 44, 44] } }))
    const link = layers(clip)[0]
    expect(link.type).toBe('text')
    expect(link.padding).toBe(44)
    expect(link.backgroundColor).toBe('rgb(13, 17, 23)')
  })
})

describe('MC-1f: container names', () => {
  it('names an unnamed container after its first named child, else group-<n>', () => {
    const named1 = emit(statScene())
    expect(layers(named1.clip).map((c) => c.name)).toContain('big-group')
    const scene = statScene()
    const col = scene.root.children[1]
    col.children.forEach((c) => (c.id = undefined))
    const { clip } = emit(scene)
    expect(layers(clip).map((c) => c.name)).toContain('group-1')
    expect(layers(clip).map((c) => c.name).join(',')).not.toMatch(/div\d/)
  })
})

describe('MC-1g: converted text is never wrapped again by the engine', () => {
  const STAGE = { width: 1080, height: 1920 }
  // 12 characters at 50 px, 25 px each in the browser: "Splash proof" fills its 300 px box exactly.
  const CONTENT = 'Splash proof'
  const DOM_WIDTH = CONTENT.length * 25

  /** A measuring double whose glyphs are `wider` times the browser's. */
  const engineMeasure = (wider: number) => {
    const ctx = {
      font: '',
      measureText: (t: string) => ({ width: Array.from(t).length * Number(/([\d.]+)px/.exec(ctx.font)?.[1] ?? 0) * 0.5 * wider }),
    }
    return ctx as unknown as CanvasRenderingContext2D
  }

  function chipScene(align: 'left' | 'center' | 'right', style: MeasuredNode['style'] = {}): MeasuredScene {
    const b = { x: 100, y: 200, width: DOM_WIDTH, height: 60 }
    const chip: MeasuredNode = {
      id: 'chip',
      tag: 'p',
      box: b,
      style: { color: '#ffffff', fontFamily: 'inter, sans-serif', fontSize: 50, fontWeight: 400, lineHeight: 60, textAlign: align, ...style },
      text: { lines: [{ text: CONTENT, box: b }] },
      children: [],
    }
    return { name: 'chip', at: 0, duration: 1, stage: STAGE, root: { tag: 'section', box: { x: 0, y: 0, ...STAGE }, style: {}, children: [chip] } }
  }

  const textOf = (scene: MeasuredScene) => named(emit(scene).clip, 'chip')

  for (const align of ['left', 'center', 'right'] as const) {
    it(`${align}: an engine measuring 1% wider keeps one line and the glyphs where the browser put them`, () => {
      const text = textOf(chipScene(align))
      const layout = computeTextLayout(engineMeasure(1.01), text as never, STAGE)
      expect(layout.lines).toEqual([CONTENT])
      const expected = align === 'left' ? 100 : align === 'center' ? 100 + DOM_WIDTH / 2 : 100 + DOM_WIDTH
      expect(layout.anchorX).toBeCloseTo(expected, 6)
      expect(layout.firstLineY).toBeCloseTo(200 + 30, 6)
    })
  }

  it('without the slack the same engine does wrap it (the failure this guards)', () => {
    const text = textOf(chipScene('left'))
    const tight = { ...text, textBox: { ...text.textBox!, width: DOM_WIDTH } }
    expect(computeTextLayout(engineMeasure(1.01), tight as never, STAGE).lines).toHaveLength(2)
  })

  it('the slack is max(4 px, 3 % of the width)', () => {
    expect(textSlack(100)).toBe(4)
    expect(textSlack(1000)).toBeCloseTo(30, 6)
  })

  it('a scaled text keeps its glyphs in place too (the anchor, not x, absorbs the slack)', () => {
    const text = textOf(chipScene('right', { scale: '1.5' }))
    const layout = computeTextLayout(engineMeasure(1.01), text as never, STAGE)
    expect(layout.lines).toEqual([CONTENT])
    // Scale about the box centre: the right edge sits 1.5 x half the width right of the centre.
    expect(layout.anchorX).toBeCloseTo(100 + DOM_WIDTH / 2 + (DOM_WIDTH / 2) * 1.5, 4)
  })

  it('text that paints its own background keeps its box size and cannot grow a row: it shrinks to the measured lines', () => {
    const text = textOf(chipScene('left', { backgroundColor: 'rgb(255, 209, 102)', padding: 0 }))
    expect(text.backgroundColor).toBeDefined()
    expect(text.textBox).toMatchObject({ overflow: 'shrink', maxLines: 1, width: DOM_WIDTH })
    const layout = computeTextLayout(engineMeasure(1.01), text as never, STAGE)
    expect(layout.lines).toEqual([CONTENT])
    expect(layout.box.width).toBeCloseTo(DOM_WIDTH, 6)
    expect(layout.style.fontSize).toBeLessThan(50)
    expect(layout.style.fontSize).toBeGreaterThan(48)
  })

  it('split-pill text parts get the slack too', () => {
    const { clip } = emit(
      chipScene('left', { backgroundImage: 'linear-gradient(90deg, rgb(255, 61, 127), rgb(255, 209, 102))', paddings: [0, 0, 0, 0] }),
    )
    const pill = layers(clip)[0]
    const part = layers(pill).find((c) => c.type === 'text')!
    expect(part.textBox).toMatchObject({ overflow: 'wrap' })
    expect(part.textBox?.width).toBeCloseTo(DOM_WIDTH + textSlack(DOM_WIDTH), 6)
  })
})

describe('rich stagger on a parent (MOT-2)', () => {
  const leaf = (id: string): MeasuredNode => ({
    tag: 'p',
    id,
    box: { x: 0, y: 0, width: 100, height: 20 },
    style: { color: '#fff', fontSize: 16 },
    text: { lines: [{ text: id, box: { x: 0, y: 0, width: 100, height: 20 } }] },
    motion: 'in: fade-in 0.3s',
    children: [],
  })
  const build = (motion: string): MeasuredScene => ({
    name: 'st',
    at: 0,
    duration: 3,
    stage: { width: 200, height: 200 },
    root: { tag: 'section', box: { x: 0, y: 0, width: 200, height: 200 }, style: {}, motion, children: ['a', 'b', 'c', 'd', 'e'].map(leaf) },
  })
  const firstKeys = (motion: string) => {
    const kids = layers(emit(build(motion)).clip)
    return kids.map((c) => c.keyframes?.channels.opacity?.keys[0]?.frame)
  }

  it('from center enters outward from the middle', () => {
    expect(firstKeys('stagger: children 3f from center')).toEqual([6, 3, 0, 3, 6])
  })

  it('a plain stagger stays i * each, and conversion is repeatable', () => {
    expect(firstKeys('stagger: children 4f')).toEqual([0, 4, 8, 12, 16])
    expect(firstKeys('stagger: children 3f from random')).toEqual(firstKeys('stagger: children 3f from random'))
  })
})

describe('timeline positions in a scene (MOT-6)', () => {
  const lowerThird = (pill: string, title: string, name?: string): MeasuredScene => {
    const scene = lowerThirdScene()
    const p = scene.root.children[0]
    p.motion = pill
    p.children[1].motion = title
    if (name) p.children[0].motion = name
    return scene
  }
  const titleOpacity = (clip: Clip) => {
    const pill = named(clip, 'pill')
    return layers(pill).find((c) => c.name === 'title')?.keyframes?.channels.opacity?.keys.map((k) => k.frame)
  }

  it('the title starts as the pill ends, plus 0.1 s, through a label', () => {
    const { clip, report } = emit(lowerThird('in: fade-in 0.5s @0.2; label: pillDone @>', 'in: fade-in 0.3s @pillDone+0.1'))
    expect(report.violations).toBeUndefined()
    expect(titleOpacity(clip)).toEqual([24, 33])
  })

  it('equals the same scene written with absolute seconds, deep-equal apart from ids', () => {
    /** Every layer by path with its keyframes minus ids (ids and the track maps are random per run). */
    const shape = (clip: Clip, path = ''): unknown[] =>
      layers(clip).flatMap((c) => [[path + c.name, JSON.parse(JSON.stringify(c.keyframes ?? null, (k, x) => (k === 'id' ? undefined : x)))], ...(c.type === 'compound' ? shape(c, path + c.name + '/') : [])])
    const rel = emit(lowerThird('in: fade-in 0.5s @0.2; label: pillDone @>', 'in: fade-in 0.3s @pillDone+0.1'))
    const abs = emit(lowerThird('in: fade-in 0.5s @0.2', 'in: fade-in 0.3s @0.8'))
    expect(shape(rel.clip)).toEqual(shape(abs.clip))
    expect(shape(rel.clip).length).toBeGreaterThan(2)
  })

  it('a label may be used before it is declared', () => {
    const { clip, report } = emit(lowerThird('label: go @0.5', 'in: fade-in 0.3s @go', 'in: fade-in 0.3s @go+0.2'))
    expect(report.violations).toBeUndefined()
    expect(titleOpacity(clip)).toEqual([15, 24])
  })

  it('reports an unknown label and a cycle', () => {
    const unknown = emit(lowerThird('label: go @0.5', 'in: fade-in 0.3s @goo'))
    expect(unknown.report.violations?.[0]).toMatchObject({ element: 'title', substitute: 'go' })
    const cycle = emit(lowerThird('label: a @b', 'label: b @a'))
    expect(cycle.report.violations?.some((v) => /cannot be placed/.test(v.message))).toBe(true)
  })
})
