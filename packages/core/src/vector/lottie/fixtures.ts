/**
 * Small hand-written Lottie fixtures used by `convert.test.ts` and, later, by
 * the Media panel harness (PV-P6c-4). Copied verbatim from TICKET-PV-P6c-2's
 * Design so the ticket's own worked numbers are exactly what these produce.
 */
import type { LottieJson, LottieTransform } from './types'

export interface LottieFixture {
  name: string
  fps: number
  json: LottieJson
}

const slide: LottieJson = {
  v: '5.7.0',
  nm: 'slide',
  fr: 30,
  ip: 0,
  op: 60,
  w: 200,
  h: 200,
  layers: [
    {
      ty: 4,
      ind: 1,
      nm: 'box',
      ip: 0,
      op: 60,
      st: 0,
      ks: {
        a: { a: 0, k: [0, 0] },
        p: {
          a: 1,
          k: [
            { t: 0, s: [50, 100], o: { x: [0.33], y: [0] }, i: { x: [0.67], y: [1] } },
            { t: 30, s: [150, 100] },
          ],
        },
        s: { a: 0, k: [100, 100] },
        r: { a: 0, k: 0 },
        o: { a: 0, k: 100 },
      },
      shapes: [
        {
          ty: 'gr',
          it: [
            { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [40, 40] }, r: { a: 0, k: 0 } },
            { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 }, r: 1 },
            { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
          ],
        },
      ],
    },
  ],
}

const orbit: LottieJson = {
  v: '5.7.0',
  nm: 'orbit',
  fr: 25,
  ip: 0,
  op: 50,
  w: 100,
  h: 100,
  layers: [
    { ty: 5, ind: 1, nm: 'title', ip: 0, op: 50, st: 0, ks: {} },
    {
      ty: 0,
      ind: 2,
      nm: 'orbit',
      refId: 'comp_1',
      w: 100,
      h: 100,
      ip: 0,
      op: 50,
      st: 0,
      ks: {
        a: { a: 0, k: [50, 50] },
        p: { a: 0, k: [50, 50] },
        s: { a: 0, k: [50, 50] },
        r: { a: 0, k: 0 },
        o: { a: 0, k: 80 },
      },
    },
    {
      ty: 1,
      ind: 3,
      nm: 'bg',
      sc: '#202020',
      sw: 100,
      sh: 100,
      ip: 0,
      op: 50,
      st: 0,
      hasMask: true,
      masksProperties: [{}],
      ks: {
        a: { a: 0, k: [50, 50] },
        p: { a: 0, k: [50, 50] },
        s: { a: 0, k: [100, 100] },
        r: { a: 0, k: 0 },
        o: { a: 0, k: 100 },
      },
    },
  ],
  assets: [
    {
      id: 'comp_1',
      layers: [
        {
          ty: 3,
          ind: 1,
          nm: 'pivot',
          ip: 0,
          op: 50,
          st: 0,
          ks: {
            a: { a: 0, k: [0, 0] },
            p: { a: 0, k: [50, 50] },
            s: { a: 0, k: [100, 100] },
            r: {
              a: 1,
              k: [
                { t: 0, s: [0], o: { x: [0], y: [0] }, i: { x: [1], y: [1] } },
                { t: 50, s: [360] },
              ],
            },
            o: { a: 0, k: 100 },
          },
        },
        {
          ty: 4,
          ind: 2,
          parent: 1,
          nm: 'dot',
          ip: 0,
          op: 50,
          st: 0,
          ef: [{}],
          ks: {
            a: { a: 0, k: [0, 0] },
            p: { a: 0, k: [30, 0] },
            s: { a: 0, k: [100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
          shapes: [
            { ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [10, 10] } },
            { ty: 'st', c: { a: 0, k: [1, 1, 1, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 2 }, lc: 2, lj: 2 },
            { ty: 'fl', c: { a: 0, k: [0, 0.5, 1, 1] }, o: { a: 0, k: 50 }, r: 1 },
          ],
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// PQ-2a fixtures. Each is a hand-written object, small enough to read whole.
// ---------------------------------------------------------------------------

const STATIC_KS: LottieTransform = {
  a: { a: 0, k: [0, 0] },
  p: { a: 0, k: [100, 100] },
  s: { a: 0, k: [100, 100] },
  r: { a: 0, k: 0 },
  o: { a: 0, k: 100 },
}
const TR = { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }
const RECT = (w: number, h: number) => ({ ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [w, h] }, r: { a: 0, k: 0 } })
const FILL = (c: number[], nm?: string) => ({ ty: 'fl', ...(nm ? { nm } : {}), c: { a: 0, k: c }, o: { a: 0, k: 100 }, r: 1 })

/** A 3 s pop: opacity fades with one bezier, scale overshoots over three keys. */
const bezierPop: LottieJson = {
  v: '5.7.0', nm: 'bezier-pop', fr: 30, ip: 0, op: 90, w: 200, h: 200,
  layers: [
    {
      ty: 4, ind: 1, nm: 'pop', ip: 0, op: 90, st: 0,
      ks: {
        ...STATIC_KS,
        o: { a: 1, k: [{ t: 0, s: [0], o: { x: [0.33], y: [0] }, i: { x: [0.67], y: [1] } }, { t: 90, s: [100] }] },
        s: {
          a: 1,
          k: [
            { t: 0, s: [10, 10], o: { x: [0.2], y: [0] }, i: { x: [0.4], y: [1.4] } },
            { t: 30, s: [120, 120], o: { x: [0.5], y: [0] }, i: { x: [0.5], y: [1] } },
            { t: 90, s: [100, 100] },
          ],
        },
      },
      shapes: [{ ty: 'gr', it: [RECT(40, 40), FILL([1, 0, 0, 1]), TR] }],
    },
  ],
}

/** A line that draws on and then erases from the start: trim `e` and `s` both keyed. */
const trimStroke: LottieJson = {
  v: '5.7.0', nm: 'trim-stroke', fr: 30, ip: 0, op: 90, w: 200, h: 200,
  layers: [
    {
      ty: 4, ind: 1, nm: 'line', ip: 0, op: 90, st: 0, ks: STATIC_KS,
      shapes: [
        {
          ty: 'gr',
          it: [
            { ty: 'sh', ks: { a: 0, k: { v: [[-60, 0], [60, 0]], i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]], c: false } } },
            { ty: 'st', c: { a: 0, k: [1, 1, 1, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 6 }, lc: 2, lj: 2 },
            {
              ty: 'tm', m: 1, o: { a: 0, k: 0 },
              s: { a: 1, k: [{ t: 30, s: [0], o: { x: [0], y: [0] }, i: { x: [1], y: [1] } }, { t: 90, s: [100] }] },
              e: { a: 1, k: [{ t: 0, s: [0], o: { x: [0.33], y: [0] }, i: { x: [0.67], y: [1] } }, { t: 45, s: [100] }] },
            },
            TR,
          ],
        },
      ],
    },
  ],
}

/** A bar cut by one static add-mode triangle mask. */
const maskedBar: LottieJson = {
  v: '5.7.0', nm: 'masked-bar', fr: 30, ip: 0, op: 60, w: 200, h: 200,
  layers: [
    {
      ty: 4, ind: 1, nm: 'bar', ip: 0, op: 60, st: 0, ks: STATIC_KS, hasMask: true,
      masksProperties: [
        {
          nm: 'Mask 1', mode: 'a', inv: false, o: { a: 0, k: 100 }, x: { a: 0, k: 0 },
          pt: { a: 0, k: { v: [[-30, -30], [30, -30], [0, 30]], i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], c: true } },
        },
      ],
      shapes: [{ ty: 'gr', it: [RECT(100, 40), FILL([0, 0.5, 1, 1]), TR] }],
    },
  ],
}

/** A circle (td) used as the alpha matte of the rectangle below it (tt). */
const matteReveal: LottieJson = {
  v: '5.7.0', nm: 'matte-reveal', fr: 30, ip: 0, op: 60, w: 200, h: 200,
  layers: [
    {
      ty: 4, ind: 1, nm: 'hole', td: 1, ip: 0, op: 60, st: 0, ks: STATIC_KS,
      shapes: [{ ty: 'gr', it: [{ ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [60, 60] } }, FILL([1, 1, 1, 1]), TR] }],
    },
    {
      ty: 4, ind: 2, nm: 'photo', tt: 1, ip: 0, op: 60, st: 0, ks: STATIC_KS,
      shapes: [{ ty: 'gr', it: [RECT(120, 80), FILL([0.2, 0.8, 0.4, 1]), TR] }],
    },
  ],
}

/** Three fills: `$accent` by name, an unnamed one in the same colour, and a keyed `$pulse`. */
const slotFill: LottieJson = {
  v: '5.7.0', nm: 'slot-fill', fr: 30, ip: 0, op: 60, w: 200, h: 200,
  layers: [
    { ty: 4, ind: 1, nm: 'badge', ip: 0, op: 60, st: 0, ks: STATIC_KS, shapes: [{ ty: 'gr', it: [RECT(60, 60), FILL([1, 0.239, 0.498, 1], '$accent'), TR] }] },
    { ty: 4, ind: 2, nm: 'dot', ip: 0, op: 60, st: 0, ks: STATIC_KS, shapes: [{ ty: 'gr', it: [RECT(20, 20), FILL([1, 0.239, 0.498, 1], 'Fill 1'), TR] }] },
    {
      ty: 4, ind: 3, nm: 'ring', ip: 0, op: 60, st: 0, ks: STATIC_KS,
      shapes: [
        {
          ty: 'gr',
          it: [
            RECT(30, 30),
            { ty: 'fl', nm: '$pulse', c: { a: 1, k: [{ t: 0, s: [1, 0, 0, 1], o: { x: [0.4], y: [0] }, i: { x: [0.6], y: [1] } }, { t: 60, s: [0, 0, 1, 1] }] }, o: { a: 0, k: 100 }, r: 1 },
            TR,
          ],
        },
      ],
    },
  ],
}

export const LOTTIE_FIXTURES: LottieFixture[] = [
  { name: 'slide', fps: 30, json: slide },
  { name: 'orbit', fps: 25, json: orbit },
  { name: 'bezier-pop', fps: 30, json: bezierPop },
  { name: 'trim-stroke', fps: 30, json: trimStroke },
  { name: 'masked-bar', fps: 30, json: maskedBar },
  { name: 'matte-reveal', fps: 30, json: matteReveal },
  { name: 'slot-fill', fps: 30, json: slotFill },
]
