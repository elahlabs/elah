/**
 * The text box (PV-P3a) — cases (a)–(r).
 *
 * The measuring double is SIZE-AWARE, which is the whole trick: it parses the
 * px out of the context's current `font` and charges half of it per character.
 * So 40 px is 20 px per character, a 100 px box holds five characters, and
 * every number in the ticket can be checked by hand:
 *
 *   stage 1000x500 · content 'HELLO BIG WORLD' (15 chars) · fontSize 40
 *     untracked width 15 x 20 = 300      line advance 40 x 1.2 = 48
 *     centre (500, 250)                  no padding (DEFAULT_PADDING is 0)
 *
 * A layout double that ignored the font size could not tell a shrink from a
 * wrap, which is the difference this ticket is about.
 */

import { describe, expect, it } from 'vitest'
import { computeTextLayout, resolveTextBox, wrapText, type TextLayout } from '../layers/textLayout'
import { NATIVE_LETTER_SPACING, paintText, textPaintSignature } from '../layers/textPaint'
import { resolveTimeline } from '../../../resolver/resolveTimeline'
import { TimelineEngine } from '../../../editor/TimelineEngine'
import type { ActiveTextClip } from '../../../resolver/scene'
import type { Clip, Project, TextBox, Track } from '../../../types'

const STAGE = { width: 1000, height: 500 }
const CONTENT = 'HELLO BIG WORLD'

/**
 * A context whose `measureText` reads the px out of the current font and
 * charges half of it per character, and which records nothing.
 */
function sizingMeasure(calls?: string[]): CanvasRenderingContext2D {
  const ctx = {
    font: '',
    measureText: (t: string) => {
      const px = Number(/([\d.]+)px/.exec(ctx.font)?.[1] ?? 0)
      calls?.push(`measureText:${t}`)
      return { width: Array.from(t).length * px * 0.5 }
    },
  }
  return ctx as unknown as CanvasRenderingContext2D
}

function item(over: Partial<ActiveTextClip> = {}): ActiveTextClip {
  return {
    id: 't',
    trackId: 'tr',
    name: 't',
    type: 'text',
    content: CONTENT,
    // 40, not the 48 default: every number in this file is derived from
    // "20 px per character", and a helper that quietly used the default would
    // make all of them wrong by a constant nobody would notice.
    fontSize: 40,
    sourceFrame: 0,
    opacity: 1,
    zIndex: 0,
    ...over,
  } as ActiveTextClip
}

function layoutOf(over: Partial<ActiveTextClip> = {}, ctx = sizingMeasure()): TextLayout {
  return computeTextLayout(ctx, item(over), STAGE)
}

// ---------------------------------------------------------------------------

describe('model', () => {
  const track: Track = {
    id: 'el-0',
    name: 'Layer 1',
    kind: 'elements',
    order: 0,
    height: 54,
    locked: false,
    disabled: false,
    muted: false,
    solo: false,
    volume: 1,
  }
  const project = (textBox?: TextBox): Project => {
    const clip = {
      id: 't-0',
      trackId: 'el-0',
      type: 'text',
      name: 't',
      startFrame: 0,
      durationFrames: 30,
      sourceStartFrame: 0,
      sourceDurationFrames: 30,
      content: 'HELLO',
      ...(textBox ? { textBox } : {}),
    } as Clip
    return {
      id: 'p',
      fps: 30,
      stage: STAGE,
      tracks: [track],
      clips: { 'el-0': [clip] },
      transitions: [],
      version: 1,
    }
  }

  it('carries textBox from a stored clip to the resolved scene', () => {
    const textBox: TextBox = { overflow: 'clip', maxLines: 2 }
    const scene = resolveTimeline(0, project(textBox))
    expect(scene.texts[0]!.textBox).toEqual(textBox)
  })

  it('adds no key at all to a legacy clip, so its layout cannot change', () => {
    const active = resolveTimeline(0, project()).texts[0]!
    expect('textBox' in active).toBe(false)
  })

  it('survives an engine round trip, which is the only test of a reader', () => {
    const engine = new TimelineEngine({ fps: 30, stage: STAGE, initialTracks: [{ kind: 'elements' }] })
    const lane = engine.addTrack('elements')
    const added = engine.addClip({
      trackId: lane.id,
      type: 'text',
      name: 't',
      startFrame: 0,
      durationFrames: 30,
      text: { content: 'HELLO' },
    })
    engine.updateClip(added.id, lane.id, { textBox: { overflow: 'shrink', maxLines: 2 } })
    expect(resolveTimeline(0, engine.getProject()).texts[0]!.textBox).toEqual({ overflow: 'shrink', maxLines: 2 })
  })
})

// ---------------------------------------------------------------------------

describe('boxed layout', () => {
  it('(a) a box with no width IS the legacy block, number for number', () => {
    const legacy = layoutOf()
    const boxed = layoutOf({ textBox: { overflow: 'wrap' } })
    expect(boxed.lines).toEqual(legacy.lines)
    expect(boxed.lineAdvance).toBe(legacy.lineAdvance)
    expect(boxed.anchorX).toBe(legacy.anchorX)
    expect(boxed.firstLineY).toBe(legacy.firstLineY)
    expect(boxed.box).toEqual(legacy.box)
    expect(boxed.font).toBe(legacy.font)
    expect(boxed.center).toEqual(legacy.center)
    // And those legacy numbers, written out so a change in the untouched path
    // cannot pass by both sides moving together.
    expect(legacy.lines).toEqual([CONTENT])
    expect(legacy.box).toEqual({ x: 350, y: 226, width: 300, height: 48 })
    expect(legacy.anchorX).toBe(500)
    expect(legacy.firstLineY).toBe(250)
  })

  it('(b) a fixed width wraps inside it and the box is exactly that wide', () => {
    const layout = layoutOf({ textBox: { width: 100, overflow: 'wrap' } })
    expect(layout.lines).toEqual(['HELLO', 'BIG', 'WORLD'])
    expect(layout.box).toEqual({ x: 450, y: 178, width: 100, height: 144 })
    expect(layout.anchorX).toBe(500)
    expect(layout.firstLineY).toBe(202)
    expect(layout.wrapWidth).toBe(100)
  })

  it('(c) textAlign left anchors to the box edge, not the centre', () => {
    expect(layoutOf({ textAlign: 'left', textBox: { width: 100, overflow: 'wrap' } }).anchorX).toBe(450)
  })

  it('(d) lineHeight sets the advance and the box height', () => {
    const layout = layoutOf({ textBox: { overflow: 'wrap', lineHeight: 2 } })
    expect(layout.lineAdvance).toBe(80)
    expect(layout.box.height).toBe(80)
  })

  it('(e) letterSpacing widens the box and reaches the painter', () => {
    const layout = layoutOf({ content: 'HELLO', textBox: { overflow: 'wrap', letterSpacing: 5 } })
    // 5 chars x 20 = 100, plus 5 x 4 gaps = 120.
    expect(layout.box.width).toBe(120)
    expect(layout.letterSpacing).toBe(5)
  })

  it('(f) transform.scale multiplies the box, the tracking and the font', () => {
    const transform = { x: 0.5, y: 0.5, scale: 2, rotation: 0, anchor: { x: 0.5, y: 0.5 } }
    const box = resolveTextBox({ width: 100, overflow: 'wrap', letterSpacing: 5 }, 2, STAGE)
    expect(box.wrapWidth).toBe(200)
    expect(box.letterSpacing).toBe(10)
    expect(layoutOf({ transform, textBox: { width: 100, overflow: 'wrap', letterSpacing: 5 } }).style.fontSize).toBe(80)
  })

  it('(g) clip drops the lines past maxLines and hands the painter a rect', () => {
    const layout = layoutOf({ textBox: { width: 100, maxLines: 1, overflow: 'clip' } })
    expect(layout.lines).toEqual(['HELLO'])
    expect(layout.clipRect).toEqual({ x: 450, y: 226, width: 100, height: 48 })
  })

  it('(h) verticalAlign places the lines in a box taller than its text', () => {
    for (const [align, first] of [['top', 202], ['middle', 250], ['bottom', 298]] as const) {
      const layout = layoutOf({
        content: 'HI',
        textBox: { width: 100, maxLines: 3, overflow: 'clip', verticalAlign: align },
      })
      expect(layout.box.y).toBe(178)
      expect(layout.box.height).toBe(144)
      expect(layout.firstLineY).toBe(first)
    }
  })

  it('(i) resolveTextBox clamps everything a stored document can get wrong', () => {
    const box = resolveTextBox(
      { overflow: 'bogus' as never, maxLines: 0, lineHeight: 9, width: -5, minFontSize: 0, letterSpacing: NaN },
      1,
      STAGE,
    )
    expect(box.overflow).toBe('wrap')
    expect(box.maxLines).toBeUndefined()
    expect(box.lineHeight).toBe(4)
    expect(box.fixedWidth).toBe(false)
    expect(box.wrapWidth).toBe(900)
    expect(box.minFontSize).toBe(8)
    expect(box.letterSpacing).toBe(0)
  })

  it('(i2) wrapText with no tracking is the call it always was', () => {
    const ctx = sizingMeasure()
    // The font has to be set, or the size-aware double measures everything at
    // zero and nothing ever wraps — which is a silent way to assert nothing.
    ctx.font = 'normal 40px sans-serif'
    expect(wrapText(ctx, CONTENT, 100)).toEqual(wrapText(ctx, CONTENT, 100, 0))
    expect(wrapText(ctx, CONTENT, 100, 0)).toEqual(['HELLO', 'BIG', 'WORLD'])
  })

  it('gives a wrap box no clipRect, because such a box is exactly as tall as its lines', () => {
    expect(layoutOf({ textBox: { width: 100, overflow: 'wrap' } }).clipRect).toBeUndefined()
    expect(layoutOf({ textBox: { width: 100, maxLines: 1, overflow: 'shrink' } }).clipRect).toBeUndefined()
  })

  it('omits letterSpacing from the layout when it is zero, so a legacy shape is unchanged', () => {
    expect('letterSpacing' in layoutOf({ textBox: { overflow: 'wrap' } })).toBe(false)
    expect('wrapWidth' in layoutOf()).toBe(false)
  })

  it('(b2) a fixed width the text does not fill is still the box width', () => {
    // Case (b) cannot tell `fixedWidth` from "hug the longest line": there the
    // wrap width and the longest line are both 100. A width WIDER than the text
    // can, and it is the only place the distinction is observable — so without
    // this case `contentWidth = maxLineWidth` passes every other test here.
    const layout = layoutOf({ content: 'HI', textBox: { width: 400, overflow: 'wrap' } })
    expect(layout.lines).toEqual(['HI'])
    expect(layout.wrapWidth).toBe(400)
    // 2 chars x 20 = 40 of text in a 400 px box.
    expect(layout.box).toEqual({ x: 300, y: 226, width: 400, height: 48 })
  })

  it('(b3) a wrap width is measured WITH the tracking, not without it', () => {
    // 'A B' is 3 chars: 60 px raw, 70 px tracked (two 5 px gaps). At a 65 px
    // wrap width the raw width fits and the tracked one does not, so this is the
    // only case that can tell a tracked wrap from an untracked one. With no
    // tracking the same box keeps the line whole.
    expect(layoutOf({ content: 'A B', textBox: { width: 65, letterSpacing: 5, overflow: 'wrap' } }).lines).toEqual(['A', 'B'])
    expect(layoutOf({ content: 'A B', textBox: { width: 65, overflow: 'wrap' } }).lines).toEqual(['A B'])
  })
})

// ---------------------------------------------------------------------------

describe('shrink', () => {
  it('(j) shrinks until the headline is one line', () => {
    const layout = layoutOf({ textBox: { width: 100, maxLines: 1, overflow: 'shrink' } })
    expect(layout.style.fontSize).toBe(13)
    expect(layout.lines).toEqual([CONTENT])
    expect(layout.font).toBe('normal 13px sans-serif')
    expect(layout.box.height).toBeCloseTo(15.6, 6)
  })

  it('(k) stops at minFontSize and lets the box grow past maxLines', () => {
    const layout = layoutOf({ textBox: { width: 100, maxLines: 1, overflow: 'shrink', minFontSize: 20 } })
    expect(layout.style.fontSize).toBe(20)
    expect(layout.lines).toEqual(['HELLO BIG', 'WORLD'])
    expect(layout.box.height).toBe(48)
  })

  it('(l) leaves text that already fits alone', () => {
    expect(layoutOf({ content: 'HI', textBox: { width: 100, maxLines: 1, overflow: 'shrink' } }).style.fontSize).toBe(40)
  })

  it('(m) converges in a bounded number of measurements', () => {
    const calls: string[] = []
    layoutOf({ textBox: { width: 100, maxLines: 1, overflow: 'shrink' } }, sizingMeasure(calls))
    // Two bracket probes plus at most 12 binary steps, each measuring a wrap
    // (2 candidates) and its lines (2). A loose ceiling that only fails if the
    // search is unbounded.
    expect(calls.length).toBeLessThan(200)
    expect(calls.length).toBeGreaterThan(0)
  })

  it('(m2) lands on a whole or half pixel, whatever the search converged to', () => {
    // The half-pixel floor is invisible in case (j): with the default floor of 8
    // the bracket is exactly 32 wide, and halving an even integer gap leaves
    // every candidate ON the half-pixel grid — so rounding and not rounding agree
    // and the assertion proves nothing. A floor that is not a power-of-two
    // multiple of the font size (9, 11, 13) puts the candidates off that grid,
    // which is what makes the property observable.
    for (const minFontSize of [9, 11, 13, 17]) {
      for (const width of [100, 130, 200, 275]) {
        const size = layoutOf({ textBox: { width, maxLines: 1, overflow: 'shrink', minFontSize } }).style.fontSize
        expect(Number.isInteger(size * 2)).toBe(true)
        expect(size).toBeGreaterThanOrEqual(minFontSize)
        expect(size).toBeLessThanOrEqual(40)
      }
    }
  })
})

// ---------------------------------------------------------------------------

/**
 * A recording context with `rect` and `clip`, and optionally a `letterSpacing`
 * accessor. `fillText` records its ARGUMENTS, which is what the tracking cases
 * are about — a recorder that kept only the string could not tell a tracked line
 * from an untracked one.
 */
function recordingCtx(options: { nativeLetterSpacing?: boolean } = {}) {
  const calls: string[] = []
  const ctx: Record<string, unknown> = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    measureText: (t: string) => {
      const px = Number(/([\d.]+)px/.exec(ctx.font as string)?.[1] ?? 0)
      return { width: Array.from(t).length * px * 0.5 }
    },
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    translate: () => calls.push('translate'),
    rotate: () => calls.push('rotate'),
    scale: () => calls.push('scale'),
    beginPath: () => calls.push('beginPath'),
    moveTo: () => {},
    arcTo: () => {},
    closePath: () => {},
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    rect: (x: number, y: number, w: number, h: number) => calls.push(`rect(${x},${y},${w},${h})`),
    clip: () => calls.push('clip'),
    fillText: (t: string, x: number, y: number) => calls.push(`fillText(${t},${x},${y})`),
    strokeText: (t: string, x: number, y: number) => calls.push(`strokeText:${t}@${x},${y}`),
  }
  // `textAlign` is recorded because the tracked path is the one place the
  // painter CHANGES it: tracking moves a line's centre, so a tracked line is
  // drawn left-aligned at a computed left, and that switch is part of what the
  // tracking cases are asserting.
  let align = 'left'
  Object.defineProperty(ctx, 'textAlign', {
    get: () => align,
    set: (v: string) => {
      align = v
      calls.push(`textAlign=${v}`)
    },
    enumerable: true,
  })
  if (options.nativeLetterSpacing) {
    let ls = '0px'
    Object.defineProperty(ctx, 'letterSpacing', {
      get: () => ls,
      set: (v: string) => {
        ls = v
        calls.push(`letterSpacing=${v}`)
      },
      enumerable: true,
    })
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

describe('painter', () => {
  it('(n) clips the glyphs to the content area, and releases the clip before the outer restore', () => {
    const { ctx, calls } = recordingCtx()
    paintText(ctx, item({ textBox: { width: 100, maxLines: 1, overflow: 'clip' } }), STAGE)
    const rectAt = calls.indexOf('rect(450,226,100,48)')
    const clipAt = calls.indexOf('clip')
    const fillAt = calls.indexOf('fillText(HELLO,500,250)')
    expect(rectAt).toBeGreaterThanOrEqual(0)
    expect(clipAt).toBeGreaterThan(rectAt)
    expect(fillAt).toBeGreaterThan(clipAt)
    // A restore between the glyph and the final one is what makes the clip local.
    expect(calls.slice(fillAt + 1)).toEqual(['restore', 'restore'])
  })

  it('(n2) a wrap box issues no clip calls at all', () => {
    const { ctx, calls } = recordingCtx()
    paintText(ctx, item({ textBox: { width: 100, overflow: 'wrap' } }), STAGE)
    expect(calls.some((c) => c === 'clip' || c.startsWith('rect('))).toBe(false)
  })

  it.runIf(NATIVE_LETTER_SPACING)('(o) uses the native letterSpacing when the context has it', () => {
    const { ctx, calls } = recordingCtx({ nativeLetterSpacing: true })
    paintText(ctx, item({ content: 'HELLO', textBox: { overflow: 'wrap', letterSpacing: 5 } }), STAGE)
    // The exact sequence the ticket names, read as a window around the one call
    // that can only be the tracked draw. Not the whole log: `paintText` brackets
    // everything in its own save/restore, and that pair is not what is under test.
    const at = calls.indexOf('letterSpacing=5px')
    expect(at).toBeGreaterThan(0)
    expect(calls.slice(at - 2, at + 3)).toEqual([
      'textAlign=left',
      'save',
      'letterSpacing=5px',
      'fillText(HELLO,440,250)',
      'restore',
    ])
    // And it is set exactly once, inside that pair — the confinement is the point.
    expect(calls.filter((c) => c.startsWith('letterSpacing='))).toEqual(['letterSpacing=5px'])
  })

  it('(p) falls back to one draw per glyph when the context has no letterSpacing', () => {
    const { ctx, calls } = recordingCtx()
    paintText(ctx, item({ content: 'HELLO', textBox: { overflow: 'wrap', letterSpacing: 5 } }), STAGE)
    expect(calls.filter((c) => c.startsWith('fillText'))).toEqual([
      'fillText(H,440,250)',
      'fillText(E,465,250)',
      'fillText(L,490,250)',
      'fillText(L,515,250)',
      'fillText(O,540,250)',
    ])
  })

  it('(p2) a tracked outline line goes through drawGlyphs, still one glyph at a time', () => {
    const { ctx, calls } = recordingCtx()
    paintText(
      ctx,
      item({
        content: 'HI',
        textOutline: { color: '#000', width: 2 },
        textBox: { overflow: 'wrap', letterSpacing: 5 },
      }),
      STAGE,
    )
    // 2 chars: 2 x 20 = 40 untracked, + 1 gap of 5 = 45 tracked, so the block is
    // centred at 500 - 45/2 = 477.5 and the second glyph lands one advance and
    // one gap further right.
    expect(calls.filter((c) => c.startsWith('strokeText:') || c.startsWith('fillText('))).toEqual([
      'strokeText:H@477.5,250',
      'fillText(H,477.5,250)',
      'strokeText:I@502.5,250',
      'fillText(I,502.5,250)',
    ])
  })

  it('(q) tracks an animated token at the same positions the layout measured', () => {
    const { ctx, calls } = recordingCtx()
    paintText(
      ctx,
      item({
        content: 'HI YO',
        textAnimator: { unit: 'word', preset: 'typewriter', staggerFrames: 0, durationFrames: 1 },
        localFrame: 0,
        textBox: { overflow: 'wrap', letterSpacing: 5 },
      }),
      STAGE,
    )
    expect(calls.filter((c) => c.startsWith('fillText('))).toEqual([
      'fillText(H,440,250)',
      'fillText(I,465,250)',
      'fillText(Y,515,250)',
      'fillText(O,540,250)',
    ])
  })

  it('(q2) an untracked animated line issues exactly the calls it always did', () => {
    const { ctx, calls } = recordingCtx()
    paintText(
      ctx,
      item({
        content: 'HI YO',
        textAnimator: { unit: 'word', preset: 'typewriter', staggerFrames: 0, durationFrames: 1 },
        localFrame: 0,
      }),
      STAGE)
    // Untracked: 5 chars x 20 = 100 wide, so the block starts at 500 - 50 = 450,
    // and 'YO' follows the 3-character prefix 'HI ' = 60 px further right.
    expect(calls.filter((c) => c.startsWith('fillText('))).toEqual([
      'fillText(HI,450,250)',
      'fillText(YO,510,250)',
    ])
  })

  it('(r) the paint signature changes with the box and with its line limit', () => {
    const plain = item()
    const boxed = item({ textBox: { overflow: 'wrap' } })
    const oneLine = item({ textBox: { overflow: 'clip', maxLines: 1 } })
    const twoLines = item({ textBox: { overflow: 'clip', maxLines: 2 } })
    expect(textPaintSignature(plain, STAGE)).not.toBe(textPaintSignature(boxed, STAGE))
    expect(textPaintSignature(oneLine, STAGE)).not.toBe(textPaintSignature(twoLines, STAGE))
    // A clip with no box at all is byte-identical to the old signature shape.
    expect(textPaintSignature(plain, STAGE).endsWith('null]')).toBe(true)
  })
})
