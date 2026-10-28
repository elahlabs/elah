/**
 * The title-card starter, written as a VideoSpec instead of an HTML scene, for
 * the HTML / VideoSpec toggle in the binding explainer. VideoSpec is live in
 * 1.0. `titleCardSpec.test.ts` builds it with `buildVideo` so the
 * names it uses cannot drift out of the vocabulary.
 */
export const titleCardSpec = {
  version: 1,
  title: 'Title card',
  format: { width: 1920, height: 1080, fps: 30 },
  duration: 4,
  background: '$bg',
  design: {
    colors: [
      { name: 'bg', value: '#0d1117' },
      { name: 'ink', value: '#ffffff' },
      { name: 'muted', value: '#9ca3af' },
      { name: 'accent', value: '#00c2ff' },
    ],
    fonts: [
      { role: 'sans', font: 'inter' },
      { role: 'display', font: 'bebas-neue' },
    ],
  },
  elements: [
    { id: 'bar', kind: 'shape', shape: 'rect', at: 0.1, duration: 3.9, w: 24, h: 300, fill: '$accent', x: 0.1, y: 0.5, enter: 'slide-in-left' },
    {
      id: 'title', kind: 'text', at: 0, duration: 4, text: 'Quarterly results', font: '$display', size: 200, color: '$ink',
      x: 0.5, y: 0.45, maxWidth: 1500, reveal: { preset: 'word-rise', stagger: 0.1, duration: 0.5 },
    },
    { id: 'sub', kind: 'text', at: 0.9, duration: 3.1, text: 'Revenue up 24 percent on the year', font: '$sans', size: 52, color: '$muted', x: 0.5, y: 0.6, enter: 'fade-in' },
  ],
}

export const titleCardSpecSource = JSON.stringify(titleCardSpec, null, 2)
