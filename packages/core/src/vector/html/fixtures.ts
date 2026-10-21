/**
 * Hand-built `MeasuredScene`s (MC-1a): what the browser measurement would hand
 * the converter for five typical scenes. The first mirrors plan section 4.5.
 */

import type { SvgNode } from '../svg/types'
import type { MeasuredBox, MeasuredLine, MeasuredNode, MeasuredScene, MeasuredStyle } from './types'

const box = (x: number, y: number, width: number, height: number): MeasuredBox => ({ x, y, width, height })

function node(tag: string, b: MeasuredBox, style: MeasuredStyle = {}, extra: Partial<MeasuredNode> = {}): MeasuredNode {
  return { tag, box: b, style, children: [], ...extra }
}

/** Lines of text laid out top to bottom from `b`, each `lineHeight` tall and as wide as `b`. */
function lines(b: MeasuredBox, lineHeight: number, ...texts: string[]): { lines: MeasuredLine[] } {
  return { lines: texts.map((text, i) => ({ text, box: box(b.x, b.y + i * lineHeight, b.width, lineHeight) })) }
}

const svgNode = (tag: string, attrs: Record<string, string>, children: SvgNode[] = []): SvgNode => ({ tag, attrs, children })

/** Plan 4.5: a ring, a big number and a label on a 1080x1920 stage. */
export function statScene(): MeasuredScene {
  const ringBox = box(46, 750, 420, 420)
  const bigBox = box(514, 828, 520, 198)
  const labelBox = box(514, 1038, 520, 106)
  return {
    name: 'stat',
    at: 12,
    duration: 4,
    stage: { width: 1080, height: 1920 },
    root: node('section', box(0, 0, 1080, 1920), {}, {
      children: [
        node('div', ringBox, {}, {
          id: 'ring',
          motion: 'draw: 0 → 0.72 1.2s expo-out @0.3; in: pop-in 0.3s',
          children: [
            node('svg', ringBox, {}, {
              svg: svgNode('svg', { viewBox: '0 0 100 100' }, [
                svgNode('circle', { cx: '50', cy: '50', r: '44', fill: 'none', stroke: '#ffd166', 'stroke-width': '8' }),
              ]),
            }),
          ],
        }),
        node('div', box(514, 828, 520, 316), {}, {
          motion: 'stagger: children 4f',
          children: [
            node('h1', bigBox, { color: '#ffffff', fontFamily: '"elah-bebas-neue", sans-serif', fontSize: 220, fontWeight: 400, lineHeight: 198, textAlign: 'left' }, {
              id: 'big',
              motion: 'in: slide-in-up 0.4s overshoot @0.4',
              text: lines(bigBox, 198, '72%'),
            }),
            node('p', labelBox, { color: '#9aa4b2', fontFamily: 'inter, sans-serif', fontSize: 44, fontWeight: 400, lineHeight: 53, textAlign: 'left' }, {
              id: 'label',
              motion: 'in: fade-in 0.3s @0.6; out: fade-out 0.3s @-0.3',
              text: lines(labelBox, 53, 'of attacks start on', 'free Wi-Fi'),
            }),
          ],
        }),
      ],
    }),
  }
}

/** A pill with a name and a title under it, on a 1920x1080 stage. */
export function lowerThirdScene(): MeasuredScene {
  const pill = box(120, 800, 700, 160)
  const nameBox = box(160, 820, 620, 56)
  const titleBox = box(160, 890, 620, 40)
  return {
    name: 'lower-third',
    at: 1,
    duration: 3,
    stage: { width: 1920, height: 1080 },
    root: node('section', box(0, 0, 1920, 1080), {}, {
      children: [
        node('div', pill, { backgroundColor: 'rgb(17, 24, 39)', borderRadius: 24, opacity: 0.9 }, {
          id: 'pill',
          children: [
            node('h2', nameBox, { color: '#ffffff', fontFamily: 'inter', fontSize: 48, fontWeight: 700, lineHeight: 56, textAlign: 'left' }, {
              id: 'name',
              text: lines(nameBox, 56, 'Asha Rao'),
            }),
            node('p', titleBox, { color: '#9aa4b2', fontFamily: 'inter', fontSize: 32, fontWeight: 400, lineHeight: 40, textAlign: 'left' }, {
              id: 'title',
              text: lines(titleBox, 40, 'Head of Security'),
            }),
          ],
        }),
      ],
    }),
  }
}

/** A centred two-line title whose second line is a gradient-clipped word, plus a tag with its own padded background. */
export function titleScene(): MeasuredScene {
  const titleBox = box(240, 400, 1440, 260)
  const wordBox = box(240, 660, 1440, 130)
  const tagBox = box(840, 860, 240, 60)
  return {
    name: 'title',
    at: 0,
    duration: 5,
    stage: { width: 1920, height: 1080 },
    root: node('section', box(0, 0, 1920, 1080), {}, {
      children: [
        node('h1', titleBox, { color: '#ffffff', fontFamily: 'playfair-display', fontSize: 120, fontWeight: 700, lineHeight: 130, textAlign: 'center', textShadow: 'rgba(0, 0, 0, 0.5) 0px 6px 12px', webkitTextStroke: '2px #ff3d7f' }, {
          id: 'headline',
          text: lines(titleBox, 130, 'Make something', 'people'),
        }),
        node('span', wordBox, { fontFamily: 'playfair-display', fontSize: 120, fontWeight: 700, lineHeight: 130, textAlign: 'center', backgroundClipText: true, backgroundImage: 'linear-gradient(90deg, #ff3d7f, #ffd166)' }, {
          id: 'word',
          text: lines(wordBox, 130, 'remember'),
        }),
        node('p', tagBox, { color: '#111111', backgroundColor: '#ffd166', borderRadius: 30, padding: 12, fontFamily: 'Comic Sans MS', fontSize: 28, fontWeight: 600, lineHeight: 36, textAlign: 'center', letterSpacing: 2 }, {
          id: 'tag',
          text: lines(tagBox, 36, 'NEW'),
        }),
      ],
    }),
  }
}

/** A clipped card with a rounded image on top and a caption, plus a circle-clipped avatar. */
export function cardScene(): MeasuredScene {
  const card = box(100, 100, 600, 700)
  const photo = box(100, 100, 600, 400)
  const capBox = box(140, 540, 520, 80)
  return {
    name: 'card',
    at: 2,
    duration: 4,
    stage: { width: 1080, height: 1080 },
    root: node('section', box(0, 0, 1080, 1080), {}, {
      children: [
        node('div', card, { backgroundColor: '#ffffff', borderRadius: 32, overflowHidden: true, borderWidth: 4, borderColor: '#222222' }, {
          id: 'card',
          children: [
            node('img', photo, { borderRadius: 32 }, { id: 'photo', img: { src: 'elah-asset:photo-1', naturalWidth: 1200, naturalHeight: 600, objectFit: 'cover' } }),
            node('p', capBox, { color: '#111111', fontFamily: 'inter', fontSize: 40, fontWeight: 700, lineHeight: 48, textAlign: 'left' }, {
              id: 'caption',
              text: lines(capBox, 48, 'Golden hour'),
            }),
            node('div', box(560, 40, 200, 200), { clipPath: 'circle(50% at 50% 50%)', backgroundColor: '#ff3d7f', zIndex: 2 }, { id: 'badge' }),
          ],
        }),
      ],
    }),
  }
}

/** An inline-svg logo with two shapes and a wordmark, rotated and scaled statically. */
export function logoScene(): MeasuredScene {
  const mark = box(400, 300, 200, 200)
  const word = box(380, 520, 240, 60)
  return {
    name: 'logo',
    at: 0,
    duration: 2,
    stage: { width: 1000, height: 1000 },
    root: node('section', box(0, 0, 1000, 1000), { backgroundColor: '#0b1020' }, {
      children: [
        node('svg', mark, { rotate: '15deg', scale: '1.5', mixBlendMode: 'screen' }, {
          id: 'mark',
          svg: svgNode('svg', { viewBox: '0 0 100 100' }, [
            svgNode('rect', { x: '10', y: '10', width: '50', height: '50', fill: '#ffd166' }),
            svgNode('circle', { cx: '65', cy: '65', r: '25', fill: '#ff3d7f' }),
          ]),
        }),
        node('p', word, { color: '#ffffff', fontFamily: 'space-grotesk', fontSize: 40, fontWeight: 700, lineHeight: 48, textAlign: 'center', mixBlendMode: 'color-dodge' }, {
          id: 'wordmark',
          text: lines(word, 48, 'ELAH'),
        }),
      ],
    }),
  }
}

export const SCENE_FIXTURES = { statScene, lowerThirdScene, titleScene, cardScene, logoScene, barScene, twoPathScene }

/**
 * MC-1e: the lower-third's draw-on bar. A 664 x 8 box holding an svg whose only
 * path is a horizontal stroke 8 wide, `draw` written on the wrapper div.
 */
export function barScene(): MeasuredScene {
  const barBox = box(120, 900, 664, 8)
  return {
    name: 'bar',
    at: 0,
    duration: 2,
    stage: { width: 1080, height: 1920 },
    root: node('section', box(0, 0, 1080, 1920), {}, {
      children: [
        node('div', barBox, {}, {
          id: 'bar',
          motion: 'draw: 0 → 1 0.7s expo-out @0.3',
          children: [
            node('svg', barBox, {}, {
              svg: svgNode('svg', { viewBox: '0 0 664 8', width: '664', height: '8' }, [
                svgNode('path', { d: 'M4 4 H660', fill: 'none', stroke: '#ffd166', 'stroke-width': '8', 'stroke-linecap': 'round' }),
              ]),
            }),
          ],
        }),
      ],
    }),
  }
}

/** MC-1e: a wrapper that holds an svg of two paths (a compound), `draw` written on the wrapper. */
export function twoPathScene(): MeasuredScene {
  const b = box(100, 100, 200, 100)
  return {
    name: 'two-path',
    at: 0,
    duration: 2,
    stage: { width: 1000, height: 1000 },
    root: node('section', box(0, 0, 1000, 1000), {}, {
      children: [
        node('div', b, {}, {
          id: 'wrap',
          motion: 'draw: 0 → 1 0.5s expo-out @0.2; in: fade-in 0.3s',
          children: [
            node('svg', b, {}, {
              svg: svgNode('svg', { viewBox: '0 0 200 100' }, [
                svgNode('path', { d: 'M10 20 H190', fill: 'none', stroke: '#ffffff', 'stroke-width': '6' }),
                svgNode('path', { d: 'M10 80 H190', fill: 'none', stroke: '#ff3d7f', 'stroke-width': '6' }),
              ]),
            }),
          ],
        }),
      ],
    }),
  }
}
