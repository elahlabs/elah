/**
 * Specs for the homepage demos: the hero piece and the capability tiles.
 * Each is a VideoSpec (experimental layer) built with `buildVideo` into an
 * ordinary project, so every animated value on screen is a key on a clip.
 * `scripts/build-demos.mjs` writes the built projects to `lib/demos/projects/`
 * so they are reviewable as plain JSON, and `demos.test.ts` fails if the
 * committed JSON drifts from these specs.
 */

const design = {
  colors: [
    { name: 'bg', value: '#170F10' },
    { name: 'ink', value: '#FBF3F1' },
    { name: 'muted', value: '#A8999B' },
    { name: 'accent', value: '#F0625A' },
    { name: 'accentSoft', value: '#3D3032' },
    { name: 'surface', value: '#261A1C' },
    { name: 'warm', value: '#E0A33A' },
    { name: 'mint', value: '#3DDC97' },
  ],
  fonts: [
    { role: 'sans', font: 'inter' },
    { role: 'display', font: 'space-grotesk' },
    { role: 'mono', font: 'roboto-mono' },
  ],
}

const tile = (title: string, elements: unknown[], extra: Record<string, unknown> = {}) => ({
  version: 1,
  title,
  format: { width: 640, height: 360, fps: 30 },
  duration: 3,
  background: '$bg',
  design,
  elements,
  ...extra,
})

/** 8 s hero loop. Elements use explicit keys so the diamonds on the timeline are real keys. */
export const heroSpec = {
  version: 1,
  title: 'Motion as code',
  format: { width: 1280, height: 720, fps: 30 },
  duration: 8,
  background: '$bg',
  design,
  elements: [
    { id: 'bar', kind: 'shape', shape: 'rect', at: 0, duration: 8, w: 14, h: 230, fill: '$accent', x: 0.1, y: 0.4, enter: 'slide-in-left' },
    {
      id: 'title', kind: 'text', at: 0.2, duration: 7.6, text: 'Motion as code', font: '$display', size: 120, color: '$ink',
      x: 0.5, y: 0.34, maxWidth: 1000, reveal: { preset: 'word-rise', stagger: 0.12, duration: 0.5 },
    },
    { id: 'sub', kind: 'text', at: 1.2, duration: 6.6, text: 'that stays editable', font: '$sans', size: 54, color: '$muted', x: 0.5, y: 0.5, enter: 'fade-in' },
    {
      id: 'ring', kind: 'shape', shape: 'arc', at: 0.6, duration: 7.2, w: 150, h: 150, stroke: '$accent', strokeWidth: 12, cap: 'round',
      x: 0.2, y: 0.76, draw: { duration: 1.4, curve: 'cubic-out' },
    },
    {
      id: 'dot', kind: 'shape', shape: 'circle', at: 0.4, duration: 7.4, w: 64, h: 64, fill: '$warm', x: 0.3, y: 0.76,
      keys: [
        { channel: 'x', at: 0, value: 0.3 },
        { channel: 'x', at: 1.8, value: 0.78, curve: 'back-out' },
        { channel: 'x', at: 3.6, value: 0.3, curve: 'cubic-in-out' },
        { channel: 'x', at: 5.4, value: 0.78, curve: 'spring:bouncy' },
        { channel: 'x', at: 7.2, value: 0.3, curve: 'cubic-in-out' },
        { channel: 'scale', at: 0, value: 1 },
        { channel: 'scale', at: 1.8, value: 1.3, curve: 'elastic-out' },
        { channel: 'scale', at: 3.6, value: 1, curve: 'cubic-out' },
        { channel: 'scale', at: 5.4, value: 1.3, curve: 'elastic-out' },
        { channel: 'scale', at: 7.2, value: 1, curve: 'cubic-out' },
      ],
    },
    {
      id: 'tag', kind: 'text', at: 2.4, duration: 5.4, text: 'Open source. Renders in the browser.', font: '$mono', size: 30, color: '$accent',
      x: 0.5, y: 0.9, enter: 'fade-in',
    },
  ],
}

/** Capability tiles, 3 s loops, one idea each. */
export const tileSpecs: Record<string, ReturnType<typeof tile>> = {
  easing: tile('Easing and springs', [
    ...(['back-out', 'elastic-out', 'spring:bouncy'] as const).map((curve, i) => ({
      id: `e${i}`, kind: 'shape', shape: 'circle', at: 0, duration: 3, w: 44, h: 44, fill: i === 0 ? '$accent' : i === 1 ? '$warm' : '$mint', x: 0.15, y: 0.25 + i * 0.25,
      keys: [
        { channel: 'x', at: 0.2, value: 0.15 },
        { channel: 'x', at: 1.6, value: 0.85, curve },
        { channel: 'x', at: 2.9, value: 0.85, hold: true },
      ],
    })),
  ]),
  stagger: tile('Stagger', [
    ...[0, 1, 2, 3, 4].map((i) => ({
      id: `s${i}`, kind: 'shape', shape: 'rect', at: 0.1 + i * 0.15, duration: 2.8 - i * 0.15, w: 60, h: 160, fill: '$accent', x: 0.2 + i * 0.15, y: 0.5, enter: 'pop-in', exit: 'fade-out',
    })),
  ]),
  text: tile('Text animators', [
    { id: 'line1', kind: 'text', at: 0.1, duration: 2.8, text: 'Letters rise', font: '$display', size: 64, color: '$ink', x: 0.5, y: 0.35, reveal: { preset: 'char-rise', stagger: 0.04, duration: 0.4 } },
    { id: 'line2', kind: 'text', at: 0.8, duration: 2.1, text: 'then words pop', font: '$sans', size: 40, color: '$accent', x: 0.5, y: 0.6, reveal: { preset: 'word-pop', stagger: 0.12, duration: 0.3 } },
  ]),
  path: tile('Motion paths and draw-on', [
    {
      id: 'curve', kind: 'shape', shape: 'path', at: 0, duration: 3, path: 'M 2 18 C 6 2, 14 2, 22 18', viewBox: { x: 0, y: 0, width: 24, height: 24 }, w: 480, h: 240, stroke: '$accent', strokeWidth: 6, cap: 'round', x: 0.5, y: 0.5,
      draw: { duration: 1.6, curve: 'cubic-out' },
    },
    {
      id: 'rider', kind: 'shape', shape: 'circle', at: 0, duration: 3, w: 36, h: 36, fill: '$warm', x: 0.1, y: 0.7,
      raw: {
        motionPath: { d: 'M 80 270 C 200 40, 440 40, 560 270' },
        keyframes: {
          channels: {
            'motion.progress': {
              source: { kind: 'keyframes' },
              keys: [
                { id: 'p0', frame: 0, value: 0, easing: 'linear' },
                { id: 'p1', frame: 75, value: 1, easing: 'cubic-in-out' },
              ],
            },
          },
        },
      },
    },
  ]),
  expressions: tile('Expressions', [
    { id: 'wob', kind: 'shape', shape: 'circle', at: 0, duration: 3, w: 90, h: 90, fill: '$accent', x: 0.35, y: 0.5, expressions: [{ channel: 'y', source: 'wiggle(3, 0.06)' }] },
    { id: 'pulse', kind: 'shape', shape: 'circle', at: 0, duration: 3, w: 90, h: 90, fill: '$warm', x: 0.65, y: 0.5, expressions: [{ channel: 'scale', source: '1 + 0.25 * sin(t * 6)' }] },
  ]),
  tilt: tile('3D tilt for media and groups', [
    {
      id: 'card', kind: 'group', at: 0, duration: 3, x: 0.5, y: 0.5, w: 360, h: 200,
      raw: {
        keyframes: {
          channels: {
            rotateY: {
              source: { kind: 'keyframes' },
              keys: [
                { id: 't0', frame: 0, value: -0.6, easing: 'linear' },
                { id: 't1', frame: 45, value: 0.6, easing: 'cubic-in-out' },
                { id: 't2', frame: 89, value: -0.6, easing: 'cubic-in-out' },
              ],
            },
          },
        },
      },
      children: [
        { id: 'card-bg', kind: 'shape', shape: 'rect', at: 0, duration: 3, w: 360, h: 200, fill: '$surface', radius: 24, x: 0.5, y: 0.5 },
        { id: 'card-t', kind: 'text', at: 0, duration: 3, text: 'Tilt', font: '$display', size: 72, color: '$ink', x: 0.5, y: 0.5 },
      ],
    },
  ]),
  effects: tile('Effects and transitions', [
    {
      id: 'fx-a', kind: 'text', at: 0, duration: 1.5, text: 'Effects', font: '$display', size: 96, color: '$ink', x: 0.5, y: 0.5,
      effects: [{ kind: 'glow' }],
    },
    { id: 'fx-b', kind: 'text', at: 1.5, duration: 1.5, text: 'Transitions', font: '$display', size: 96, color: '$mint', x: 0.5, y: 0.5 },
  ]),
}

type Clip = { id: string; trackId: string; name: string; startFrame: number; durationFrames: number }
type Proj = { tracks: { id: string }[]; clips: Record<string, Clip[]>; transitions: unknown[] }

/**
 * The spec has no transition field, so the 'effects' tile puts its two clips on
 * one track and adds a zoom transition between them (a transition joins two
 * clips of one track). Applied by `scripts/build-demos.mjs` and the drift test.
 */
export function patchProject(name: string, project: Proj): Proj {
  if (name !== 'effects') return project
  const all = Object.values(project.clips).flat()
  const a = all.find((c) => c.name === 'Effects')
  const b = all.find((c) => c.name === 'Transitions')
  if (!a || !b) throw new Error('effects tile: clips not found')
  const lane = a.trackId
  const moved: Clip = { ...b, trackId: lane, startFrame: a.startFrame + a.durationFrames }
  const clips: Record<string, Clip[]> = {}
  for (const [id, list] of Object.entries(project.clips)) clips[id] = list.filter((c) => c.id !== b.id)
  clips[lane] = [...clips[lane], moved]
  const tracks = project.tracks.filter((t) => t.id === lane || Object.values(clips[t.id] ?? []).length > 0)
  const dur = 12
  return {
    ...project,
    tracks,
    clips,
    transitions: [{ id: 'tr-zoom', kind: 'zoom', fromClipId: a.id, toClipId: moved.id, trackId: lane, startFrame: moved.startFrame - dur / 2, durationFrames: dur }],
  }
}
