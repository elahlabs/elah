// Content for the landing-v2 marketing home. Kept as plain data so the section
// components stay presentational. Copy mirrors the approved design; hrefs point
// at the app's real routes.

// Navigation lives in config/nav.ts: one registry for the header and footer.
import { GITHUB_URL } from '@/config/nav'
export { navLinks, footerColumns, GITHUB_URL, DISCORD_URL, GET_STARTED_URL, EDITOR_URL } from '@/config/nav'

export interface Library {
  pkg: string
  title: string
  subtitle: string
  href: string
  variant: 'editor' | 'timeline' | 'headless' | 'core' | 'react'
  /** Extra copyable command shown as a second line under the install command. */
  extraCmd?: string
}

/** Experimental subpath entries of @elah/core (1.0). They are not exported from the root entry. */
export const coreSubpaths = [
  { path: '@elah/core/spec', what: 'VideoSpec JSON to a project' },
  { path: '@elah/core/html', what: 'HTML + CSS scenes to clips and keys' },
  { path: '@elah/core/ops', what: 'Edit operations an AI can call' },
  { path: '@elah/core/icons', what: 'The vendored icon set' },
] as const

export const libraries: Library[] = [
  { pkg: '@elah/editor', title: 'Editor SDK', subtitle: 'Full editor — EditorProvider, Preview, AssetPanel, and Timeline in one composition.', href: '/playground/production', variant: 'editor' },
  { pkg: '@elah/timeline', title: 'Timeline UI', subtitle: 'React timeline — tracks, clips, drag/trim/split, ruler, playhead.', href: '/playground/timeline', variant: 'timeline' },
  { pkg: '@elah/cli', title: 'Headless Rendering', subtitle: 'Server-side render pipeline — split/trim/build/export and an HTTP render server.', href: '/docs/cli', variant: 'headless', extraCmd: 'npx @elah/cli serve' },
  { pkg: '@elah/react', title: 'React Bindings', subtitle: 'React bindings — EditorContext, useEditor, store hooks, and the audio mixer hooks.', href: '/docs/react', variant: 'react' },
  { pkg: '@elah/core', title: 'Media Runtime', subtitle: 'Framework-agnostic engine: resolver, WebGL2 renderer, WebCodecs decode, MP4 export, and the 1.0 motion layer: keyframes, springs, stagger, paths, effects.', href: '/docs/motion', variant: 'core' },
]

export interface FlowLayer {
  name: string
  items: string[]
}

export const flow: FlowLayer[] = [
  { name: 'REACT UI', items: ['Timeline', 'Preview', 'AssetPanel', 'TransformOverlay'] },
  { name: 'REACT BINDINGS', items: ['EditorContext', 'useEditor', 'store hooks', 'audio mixer hooks'] },
  { name: 'ENGINE LAYER', items: ['TimelineEngine', 'PlaybackEngine', 'AudioPlaybackController'] },
  { name: 'PURE RESOLVER', items: ['resolveTimeline(frame, project) → Scene'] },
  { name: 'RENDERERS', items: ['GpuRenderer (WebGL2)', 'Video · Image · Text layers', 'Shape · Freehand layers', 'ExportWorker (OffscreenCanvas)'] },
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

/** Status-pill colours, shared by the playground cards and the showcase cards. */
export const badgeColors = { live: '#3ddc97', preview: '#e0b33c' } as const

export const playgrounds: PlaygroundEntry[] = [
  {
    badge: 'preview',
    badgeColor: badgeColors.preview,
    playhead: '30%',
    delay: '0s',
    title: 'Motion',
    body: 'Write a scene as HTML and CSS, convert it to clips and keyframes, read the keys in a table, and export an MP4 in your browser. Experimental.',
    href: '/playground/motion',
    variant: 'timeline',
  },
  {
    badge: 'live',
    badgeColor: badgeColors.live,
    playhead: '38%',
    delay: '0s',
    title: 'Full Editor',
    body: 'Complete editor with asset panel, GPU-accelerated preview, interactive overlays, timeline, and export pipeline. The full @elah/editor composition.',
    href: '/playground/production',
    variant: 'full',
  },
  {
    badge: 'live',
    badgeColor: badgeColors.live,
    playhead: '62%',
    delay: '-3s',
    title: 'Timeline Only',
    body: 'Isolated timeline UI demo. Explore tracks, clips, snapping, keyboard shortcuts, and the TimelineEngine without the full editor stack.',
    href: '/playground/timeline',
    variant: 'timeline',
  },
  {
    badge: 'preview',
    badgeColor: badgeColors.preview,
    playhead: '22%',
    delay: '-6s',
    title: 'Full Editor Demo',
    body: 'Guided demo with pre-loaded sample media. Walks through the major features — cut, trim, text, transitions, and export — in a single session.',
    href: '/playground/raw',
    variant: 'demo',
  },
]

export interface FaqItem {
  q: string
  a: string
  /** Optional follow-up link rendered under the answer. */
  href?: string
  hrefLabel?: string
}

export const faq: FaqItem[] = [
  {
    q: 'What is elah?',
    a: 'An open-source video engine. You write motion as code, or a model does, and elah converts it into ordinary clips and keyframes on a timeline. You can open it, change any key, and export an MP4 in the browser.',
    href: '/motion',
    hrefLabel: 'See how it works',
  },
  {
    q: 'What does “bound to the timeline” mean?',
    a: 'Every animated property is a channel on a clip, and every key has an id, a frame, a value and an easing. The motion is not a video and not a black box, so it can be inspected, retimed, split and diffed like any other data.',
    href: '/docs/motion',
    hrefLabel: 'Read the motion docs',
  },
  {
    q: 'Does elah need a server to export video?',
    a: 'No. Decoding, rendering and MP4 export all run in the browser, and footage is never uploaded. Export needs a Chromium browser (Chrome or Edge), and effects and the six newer transitions need WebGL2. For headless rendering, @elah/cli runs the same export pipeline with headless Chrome.',
    href: '/docs/export',
    hrefLabel: 'Read about export',
  },
  {
    q: 'Can I edit keyframes visually?',
    a: 'Not in the open-source editor yet. Keyframes are plain data: every key has an id you can read, write and diff, through the API or the project JSON. The motion playground shows them in a table you can edit as numbers.',
    href: '/playground/motion',
    hrefLabel: 'Open the motion playground',
  },
  {
    q: 'Is the exported video identical to the preview?',
    a: 'Yes. Preview and export run the same pure resolver, resolveTimeline(frame, project) → Scene, and the same placement math, so the frame you scrub is the frame you ship.',
  },
  {
    q: 'What is experimental?',
    a: 'HTML scenes (@elah/core/html), VideoSpec JSON (@elah/core/spec) and edit operations (@elah/core/ops). They have their own subpath entries and may change in a minor release. The projects they produce are ordinary projects and stay readable.',
    href: '/docs/scenes',
    hrefLabel: 'Read about scenes and VideoSpec',
  },
  {
    q: 'Can Claude or another model make videos with elah?',
    a: 'Yes. The elah plugin for Claude Code turns a short brief into a video: Claude writes it as HTML and CSS motion, the plugin validates it, and an artifact opens it for preview, editing and mp4 export. The standalone claude.ai artifact is live. The plugin is unofficial, not made or endorsed by Anthropic.',
    href: '/claude',
    hrefLabel: 'See elah for Claude',
  },
  {
    q: 'Is 1.0 on npm?',
    a: 'Yes. It shipped in 1.0, so npm install @elah/core installs it. Keyframes, springs, stagger, motion paths, effects and transitions are in the root entry and follow semver. HTML scenes, VideoSpec and edit operations are experimental subpath entries.',
    href: '/changelog',
    hrefLabel: 'Read the changelog',
  },
  {
    q: 'Is elah open source?',
    a: 'Yes. elah is open source under the Apache-2.0 license, copyright Elah Labs Private Limited. It is free to use, modify, embed, self-host, and ship in commercial products.',
  },
  {
    q: 'What export formats does elah support?',
    a: 'MP4 with H.264 video by default (VP9 and VP8 are also available) and AAC or Opus audio, at any aspect ratio, up to the project’s native resolution. HEVC, AV1, WebM transparency and GIF depend on what the browser can encode.',
  },
]
