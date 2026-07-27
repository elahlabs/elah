// Content for the landing-v2 marketing home. Kept as plain data so the section
// components stay presentational. Copy mirrors the approved design; hrefs point
// at the app's real routes.

export const navLinks = [
  { label: 'Docs', href: '/docs' },
  { label: 'Examples', href: '/examples' },
  { label: 'Playgrounds', href: '/playgrounds' },
  { label: 'Blog', href: '/blog' },
  { label: 'Pricing', href: '/pricing' },
]

export const GITHUB_URL = 'https://github.com/elahlabs/elah'
export const DISCORD_URL = 'https://discord.gg/8CeZ2XbPy'
export const GET_STARTED_URL = '/docs/getting-started'
export const EDITOR_URL = '/playground/production'
export const INSTALL_COMMAND = 'npm install @elah/core @elah/timeline @elah/editor @elah/cli'

export interface Library {
  pkg: string
  title: string
  subtitle: string
  href: string
}

export const libraries: Library[] = [
  { pkg: '@elah/core', title: 'Media Runtime', subtitle: 'Framework-agnostic engine — resolver, WebGL2 renderer, WebCodecs decode, MP4 export.', href: '/docs' },
  { pkg: '@elah/timeline', title: 'Timeline UI', subtitle: 'React timeline — tracks, clips, drag/trim/split, ruler, playhead.', href: '/playground/timeline' },
  { pkg: '@elah/editor', title: 'Editor SDK', subtitle: 'Full editor — EditorProvider, Preview, AssetPanel, and Timeline in one composition.', href: '/playground/production' },
  { pkg: '@elah/cli', title: 'Headless Rendering', subtitle: 'Server-side render pipeline — split/trim/build/export and an HTTP render server.', href: '/docs/cli' },
]

export interface Feature {
  idx: string
  title: string
  body: string
  tags: string[]
}

export const features: Feature[] = [
  {
    idx: '01',
    title: 'Frame-Accurate Time Model',
    body: 'All time is integer frames — no floating-point drift, no sync bugs. Same project + same frame = same pixels, always.',
    tags: ['Immer', 'Zustand'],
  },
  {
    idx: '02',
    title: 'WebCodecs Decode Pipeline',
    body: 'Push-based StreamingFrameProducer with ahead-of-playhead decoding. Frames are copied to ImageBitmap so the hardware output pool never starves.',
    tags: ['WebCodecs', 'ImageBitmap', 'mediabunny'],
  },
  {
    idx: '03',
    title: 'WebGL2 GPU Renderer',
    body: 'GpuRenderer turns each resolved Scene into sorted textured-quad draws composited by zIndex. Supports VideoLayer, ImageLayer, and TextLayer.',
    tags: ['WebGL2', 'OffscreenCanvas', 'GLSL'],
  },
  {
    idx: '04',
    title: 'Pure Resolver Architecture',
    body: 'resolveTimeline(frame, project) → Scene is deterministic and side-effect-free. Runs identically in preview, tests, and export workers.',
    tags: ['Pure function', 'Worker-safe'],
  },
  {
    idx: '05',
    title: 'Zero-Drift Export — Browser & Server',
    body: 'The export worker steps resolveTimeline frame-by-frame in the browser — and @elah/cli runs the exact same pipeline headlessly on your server. Bit-identical output, by construction.',
    tags: ['Web Worker', 'MP4', '@elah/cli'],
  },
  {
    idx: '06',
    title: 'Interactive Transform Overlays',
    body: 'Click-select, drag-move, corner-drag uniform scale for video and image clips. Text clips support drag, resize, inline-edit, and rotation.',
    tags: ['React', 'CSS transforms'],
  },
  {
    idx: '07',
    title: 'Full Edit History',
    body: 'Every edit goes through TimelineEngine.commit() — Immer-backed structural sharing with batching, undo/redo, and typed events.',
    tags: ['Immer', 'Undo/Redo'],
  },
  {
    idx: '08',
    title: 'Fade & Transition System',
    body: 'Snapshot-overlay architecture. Resolver sets opacity; CSS handles preview via TransitionOverlay; export mirrors with globalAlpha. Renderer-agnostic.',
    tags: ['CSS', 'globalAlpha'],
  },
  {
    idx: '09',
    title: 'Renderer-Agnostic Core',
    body: 'The data model and resolver know nothing about DOM, Canvas, or WebGL. Swap rendering backends without touching state or timeline logic.',
    tags: ['TypeScript', 'Interfaces'],
  },
]

export interface FlowLayer {
  name: string
  items: string[]
}

export const flow: FlowLayer[] = [
  { name: 'REACT UI', items: ['Timeline', 'Preview', 'AssetPanel', 'TransformOverlay'] },
  { name: 'ENGINE LAYER', items: ['TimelineEngine', 'PlaybackEngine', 'AudioPlaybackController'] },
  { name: 'PURE RESOLVER', items: ['resolveTimeline(frame, project) → Scene'] },
  { name: 'RENDERERS', items: ['GpuRenderer (WebGL2)', 'ExportWorker (OffscreenCanvas)'] },
  { name: 'MEDIA PIPELINE', items: ['StreamingFrameProducer', 'WebCodecs', 'mediabunny demux'] },
]

export interface PlaygroundEntry {
  badge: 'live' | 'preview'
  badgeColor: string
  playhead: string
  delay: string
  title: string
  body: string
  href: string
  variant: 'full' | 'timeline' | 'demo'
}

export const playgrounds: PlaygroundEntry[] = [
  {
    badge: 'live',
    badgeColor: '#3ddc97',
    playhead: '38%',
    delay: '0s',
    title: 'Full Editor',
    body: 'Complete editor with asset panel, GPU-accelerated preview, interactive overlays, timeline, and export pipeline. The full @elah/editor composition.',
    href: '/playground/production',
    variant: 'full',
  },
  {
    badge: 'live',
    badgeColor: '#3ddc97',
    playhead: '62%',
    delay: '-3s',
    title: 'Timeline Only',
    body: 'Isolated timeline UI demo. Explore tracks, clips, snapping, keyboard shortcuts, and the TimelineEngine without the full editor stack.',
    href: '/playground/timeline',
    variant: 'timeline',
  },
  {
    badge: 'preview',
    badgeColor: '#e0b33c',
    playhead: '22%',
    delay: '-6s',
    title: 'Full Editor Demo',
    body: 'Guided demo with pre-loaded sample media. Walks through the major features — cut, trim, text, transitions, and export — in a single session.',
    href: '/playground/raw',
    variant: 'demo',
  },
]

export interface IntegrationPoint {
  code: string
  rest: string
}

export const integrationPoints: IntegrationPoint[] = [
  { code: 'EditorProvider', rest: 'wires all engines with a single fps prop' },
  { code: 'Preview', rest: 'mounts the WebGL2 renderer and drives the RAF loop' },
  { code: 'Timeline', rest: 'handles all interaction: drag, trim, split, snap' },
  { code: 'AssetPanel', rest: 'manages the media library and drag-drop import' },
  { code: 'exportVideo()', rest: 'runs the full pipeline in a dedicated worker' },
]

export interface FaqItem {
  q: string
  a: string
}

export const faq: FaqItem[] = [
  {
    q: 'Does elah need a server to edit or export video?',
    a: 'No — by default everything runs in the browser: decoding (WebCodecs), rendering (WebGL2), and MP4 export (a Web Worker drawing to an OffscreenCanvas), so footage never leaves the user’s machine. When you want server-side rendering — batch jobs, AI-generated video, CI — @elah/cli runs the exact same export pipeline headlessly on your own hardware, with bit-identical output.',
  },
  {
    q: 'Can elah render video on a server?',
    a: 'Yes. npx @elah/cli serve starts a self-hosted HTTP render server: POST a seconds-based JSON spec to /render and get MP4 bytes back. It keeps a warm headless Chrome and runs core’s real exportVideo pipeline, so server output is frame-identical to the browser. There is also elah build / elah export for one-shot CLI renders, and a Node library API.',
  },
  {
    q: 'What can I build with elah?',
    a: 'An embeddable video editor inside your own product: the SDK ships EditorProvider, Preview, AssetPanel, and Timeline React components on top of a headless TypeScript engine, so you can compose a full editor in under 20 lines or drive the engine directly.',
  },
  {
    q: 'Is the exported video identical to the preview?',
    a: 'Yes. Preview and export run the same pure resolver — resolveTimeline(frame, project) → Scene — and the same placement math, so the frame you scrub is the frame you ship. Same project, same frame, same pixels.',
  },
  {
    q: 'How is elah different from Remotion?',
    a: 'Remotion turns React components into video — programmatic composition rendered by headless Chromium. elah is an editing engine: an integer-frame timeline data model with undo history, drag/trim/split UI, and a GPU export pipeline that runs in the user’s browser or headlessly via @elah/cli. The difference is the editing foundation, not where rendering happens.',
  },
  {
    q: 'Which frameworks does elah support?',
    a: 'The core engine is framework-agnostic TypeScript with zero React imports. React and Next.js bindings ship today via @elah/editor and @elah/timeline; React Native support is experimental, with more frameworks planned.',
  },
  {
    q: 'Is elah open source?',
    a: 'Yes — elah is open source under the Apache-2.0 license, copyright Elah Labs Private Limited. It’s free to use, modify, embed, self-host, and ship in commercial products, including hosted and white-label offerings. Paid support and services are available if you want them, but nothing is gated behind a license.',
  },
  {
    q: 'What export formats does elah support?',
    a: 'MP4 with H.264 video by default (VP9 and VP8 are also available) and AAC or Opus audio, at any aspect ratio — 9:16, 16:9, 1:1, or a custom stage — up to the project’s native resolution.',
  },
]

export interface TrackClip {
  left: string
  width: string
  bg: string
  border: string
  shadow: string
  label: string
  wave?: boolean
  waveColor?: string
}

export interface Track {
  name: string
  short: string
  clips: TrackClip[]
}

export const tracks: Track[] = [
  {
    name: 'Video',
    short: 'V',
    clips: [
      {
        left: '1.5%',
        width: '32%',
        bg: 'linear-gradient(180deg,#3b82f6,#1d4ed8)',
        border: '#00c2ff',
        shadow: '0 0 0 1px rgba(0,194,255,.4)',
        label: 'intro.mp4',
      },
      {
        left: '34.5%',
        width: '30%',
        bg: 'linear-gradient(180deg,#3b82f6,#1d4ed8)',
        border: '#60a5fa',
        shadow: '0 1px 2px rgba(0,0,0,.25)',
        label: 'b-roll-city.mp4',
      },
    ],
  },
  {
    name: 'Elements',
    short: 'E',
    clips: [
      {
        left: '17%',
        width: '24%',
        bg: '#7a2e10',
        border: '#ad5621',
        shadow: '0 1px 2px rgba(0,0,0,.25)',
        label: 'Launch Day',
      },
    ],
  },
  {
    name: 'Audio (Main)',
    short: 'A1',
    clips: [
      {
        left: '1.5%',
        width: '63%',
        bg: '#0c2a26',
        border: '#0d4d3c',
        shadow: '0 1px 2px rgba(0,0,0,.25)',
        label: 'bg-music.mp3',
        wave: true,
        waveColor: '#248f6c',
      },
    ],
  },
  {
    name: 'Audio 2',
    short: 'A2',
    clips: [
      {
        left: '40%',
        width: '14%',
        bg: '#0c2a26',
        border: '#0d4d3c',
        shadow: '0 1px 2px rgba(0,0,0,.25)',
        label: 'whoosh.wav',
        wave: true,
        waveColor: '#248f6c',
      },
    ],
  },
]

export const footerColumns = [
  {
    heading: 'PRODUCT',
    links: [
      { label: 'Docs', href: '/docs' },
      { label: 'Examples', href: '/examples' },
      { label: 'Playgrounds', href: '/playgrounds' },
      { label: 'Changelog', href: '/changelog' },
      { label: 'Pricing', href: '/pricing' },
    ],
  },
  {
    heading: 'DEVELOPERS',
    links: [
      { label: 'Getting Started', href: '/docs/getting-started' },
      { label: 'Timeline API', href: '/docs' },
      { label: 'Editor API', href: '/docs' },
      { label: 'Export Pipeline', href: '/docs' },
      { label: 'Architecture', href: '/docs/architecture' },
    ],
  },
  {
    heading: 'COMPANY',
    links: [
      { label: 'GitHub', href: GITHUB_URL },
      { label: 'Discord', href: DISCORD_URL },
      { label: 'Contact', href: GITHUB_URL },
      { label: 'Contributing', href: `${GITHUB_URL}/blob/main/CONTRIBUTING.md` },
      { label: 'License', href: `${GITHUB_URL}/blob/main/LICENSE` },
    ],
  },
]
