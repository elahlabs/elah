export interface DocNavItem {
  title: string
  href: string
  label?: string
}

export interface DocNavSection {
  title: string
  items: DocNavItem[]
}

export const docsNav: DocNavSection[] = [
  {
    title: 'Getting Started',
    items: [
      { title: 'Introduction', href: '/docs' },
      { title: 'Installation', href: '/docs/installation' },
      { title: 'Quick Start', href: '/docs/getting-started' },
    ],
  },
  {
    title: 'Timeline',
    items: [
      { title: 'Overview', href: '/docs/timeline' },
      { title: 'Tracks & Clips', href: '/docs/timeline#tracks-and-clips' },
      { title: 'Playback', href: '/docs/timeline#playback' },
      { title: 'Zooming & Snapping', href: '/docs/timeline#zooming' },
      { title: 'Multiple Video Tracks', href: '/docs/timeline#multiple-video-tracks' },
      { title: 'Clip Virtualization', href: '/docs/timeline#virtualization' },
      { title: 'Keyboard Shortcuts', href: '/docs/timeline#shortcuts' },
    ],
  },
  {
    title: 'Editor',
    items: [
      { title: 'Overview', href: '/docs/editor' },
      { title: 'EditorProvider', href: '/docs/editor#editor-provider' },
      { title: 'Preview', href: '/docs/editor#preview' },
      { title: 'Asset Panel', href: '/docs/editor#asset-panel' },
      { title: 'Transforms', href: '/docs/editor#transforms' },
      { title: 'Text Overlays', href: '/docs/editor#text-overlays' },
      { title: 'Transitions', href: '/docs/editor#transitions' },
    ],
  },
  {
    title: 'Clips & Tracks',
    items: [
      { title: 'Overview', href: '/docs/clips' },
      { title: 'Multiple Video Tracks', href: '/docs/clips#multiple-video-tracks' },
      { title: 'Speed', href: '/docs/clips#speed' },
      { title: 'Crop', href: '/docs/clips#crop' },
      { title: 'Corner Radius', href: '/docs/clips#corner-radius' },
      { title: 'Protected & Pinned Tracks', href: '/docs/clips#protected-and-pinned-tracks' },
      { title: 'Growing Clips', href: '/docs/clips#growing-clips' },
    ],
  },
  {
    title: 'Text & Motion',
    items: [
      { title: 'Templates & Motion', href: '/docs/text-templates-and-motion' },
      { title: 'MotionSpec', href: '/docs/text-templates-and-motion#motion-spec' },
      { title: 'Easings', href: '/docs/text-templates-and-motion#easings' },
      { title: 'Sampling', href: '/docs/text-templates-and-motion#sampling' },
      { title: 'Built-in Templates', href: '/docs/text-templates-and-motion#built-in-templates' },
      { title: 'Applying a Template', href: '/docs/text-templates-and-motion#apply-template' },
      { title: 'Style Presets', href: '/docs/text-templates-and-motion#style-presets' },
    ],
  },
  {
    title: 'Frame Sequences',
    items: [
      { title: 'Overview', href: '/docs/frame-sequences' },
      { title: 'Create a Sequence', href: '/docs/frame-sequences#create' },
      { title: 'Controller', href: '/docs/frame-sequences#controller' },
      { title: 'Preloading', href: '/docs/frame-sequences#preloading' },
      { title: 'To a Project', href: '/docs/frame-sequences#to-project' },
      { title: 'Export', href: '/docs/frame-sequences#export' },
    ],
  },
  {
    title: 'Project Documents',
    items: [
      { title: 'Overview', href: '/docs/project-documents' },
      { title: 'Reading a Document', href: '/docs/project-documents#reading-a-document' },
      { title: 'Versioning', href: '/docs/project-documents#versioning' },
      { title: 'Relinking Media', href: '/docs/project-documents#relinking-media' },
      { title: 'loadProject', href: '/docs/project-documents#load-project' },
      { title: 'Library Snapshots', href: '/docs/project-documents#media-library-snapshots' },
      { title: 'Browser Persistence', href: '/docs/project-documents#browser-persistence' },
    ],
  },
  {
    title: 'Export',
    items: [
      { title: 'Overview', href: '/docs/export' },
      { title: 'exportVideo()', href: '/docs/export#export-video' },
      { title: 'Export Worker', href: '/docs/export#worker' },
      { title: 'Audio Pipeline', href: '/docs/export#audio' },
      { title: 'Browser Limits', href: '/docs/export#limits' },
    ],
  },
  {
    title: 'CLI & Server',
    items: [
      { title: 'Overview', href: '/docs/cli' },
      { title: 'Commands', href: '/docs/cli#commands' },
      { title: 'The Build Spec', href: '/docs/cli#build-spec' },
      { title: 'Serve Mode', href: '/docs/cli#serve' },
      { title: 'Docker & Self-Hosting', href: '/docs/cli#docker' },
      { title: 'Library API', href: '/docs/cli#library-api' },
    ],
  },
  {
    title: 'React',
    items: [
      { title: '@elah/react', href: '/docs/react' },
      { title: 'EditorContext', href: '/docs/react#editor-context' },
      { title: 'Store Hooks', href: '/docs/react#store-hooks' },
      { title: 'Audio Hooks', href: '/docs/react#audio-hooks' },
      { title: 'Load State & Presets', href: '/docs/react#load-and-presets' },
      { title: 'Without React', href: '/docs/react#without-react' },
    ],
  },
  {
    title: 'Theming',
    items: [
      { title: 'Design Tokens', href: '/docs/theming' },
      { title: 'Overlay Tokens', href: '/docs/theming#overlay-tokens' },
      { title: 'classNames', href: '/docs/theming#class-names' },
      { title: 'timelineTheme', href: '/docs/theming#timeline-theme' },
    ],
  },
  {
    title: 'API Reference',
    items: [
      { title: 'TimelineEngine', href: '/docs/api#timeline-engine' },
      { title: 'PlaybackEngine', href: '/docs/api#playback-engine' },
      { title: 'resolveTimeline()', href: '/docs/api#resolve-timeline' },
      { title: 'GpuRenderer', href: '/docs/api#gpu-renderer' },
      { title: 'Hooks', href: '/docs/api#hooks' },
      { title: 'Types', href: '/docs/api#types' },
    ],
  },
  {
    title: 'Architecture',
    items: [
      { title: 'Overview', href: '/docs/architecture' },
      { title: 'Three-Ring State Model', href: '/docs/architecture#ring-states' },
      { title: 'Timeline Engine', href: '/docs/architecture#timeline-engine' },
      { title: 'Playback Engine & Clock', href: '/docs/architecture#playback-clock' },
      { title: 'Rendering Engine', href: '/docs/architecture#rendering-engine' },
      { title: 'Layer Reference', href: '/docs/architecture#overview' },
    ],
  },
  {
    title: 'Plugins',
    items: [
      { title: 'Custom Renderers', href: '/docs/plugins' },
      { title: 'Custom Layers', href: '/docs/plugins#custom-layers' },
    ],
  },
  {
    title: 'Motion',
    items: [
      { title: 'Keyframes', href: '/docs/motion' },
      { title: 'Easing & springs', href: '/docs/motion#easing' },
      { title: 'Expressions', href: '/docs/motion#expressions' },
      { title: 'Stagger, repeat & yoyo', href: '/docs/motion#stagger' },
      { title: 'Text animators', href: '/docs/motion#text' },
      { title: 'Motion paths', href: '/docs/motion#paths' },
      { title: '3D tilt', href: '/docs/motion#tilt' },
      { title: 'HTML scenes & VideoSpec', href: '/docs/scenes' },
    ],
  },
  {
    title: 'For Agents',
    items: [
      { title: 'Overview', href: '/docs/agents' },
      { title: 'One-File Guide', href: '/docs/agents#one-file-guide' },
      { title: 'Agents in the Repo', href: '/docs/agents#agents-in-the-repo' },
      { title: 'Headless Rendering', href: '/docs/agents#headless-rendering' },
      { title: 'llms.txt', href: '/docs/agents#llms-txt' },
      { title: 'WebMCP (planned)', href: '/docs/agents#webmcp' },
    ],
  },
  {
    title: 'Privacy',
    items: [{ title: 'Analytics & Tracking', href: '/docs/analytics' }],
  },
]

/**
 * The docs index (/docs): grouped cards. Lives beside `docsNav` so a new page
 * is registered in one file and the sidebar and the index cannot drift apart.
 * Keep every `href` pointing at a real route; each is also a `docsNav` entry.
 */
export interface DocsHomeCard {
  title: string
  desc: string
  href: string
}

export interface DocsHomeGroup {
  title: string
  cards: DocsHomeCard[]
}

export const docsHome: DocsHomeGroup[] = [
  {
    title: 'Start here',
    cards: [
      { title: 'Installation', desc: 'Install @elah/editor from npm and configure Next.js or Vite.', href: '/docs/installation' },
      { title: 'Quick Start', desc: 'Build the full editor in under 20 lines. Wire your demuxer, render, ship.', href: '/docs/getting-started' },
      { title: 'Architecture', desc: 'Integer frames, the one mutation funnel, the pure resolver, dumb renderers.', href: '/docs/architecture' },
    ],
  },
  {
    title: 'Build the editor',
    cards: [
      { title: 'Editor', desc: 'EditorProvider, Preview, AssetPanel, transform overlays, crop and transitions.', href: '/docs/editor' },
      { title: 'Timeline', desc: 'Tracks, clips, playback, zoom, snapping, virtualization and keyboard shortcuts.', href: '/docs/timeline' },
      { title: '@elah/react', desc: 'EditorContext, useEditor, the store hooks and the audio mixer hooks.', href: '/docs/react' },
      { title: 'Text Templates & Motion', desc: 'Layered MotionSpec animation, easings, and 14 built-in text templates.', href: '/docs/text-templates-and-motion' },
      { title: 'Theming', desc: 'The --elah-* tokens, the classNames slot API, and the three stylesheets.', href: '/docs/theming' },
      { title: 'Plugins', desc: 'Custom renderers and custom demuxers, and what is not public yet.', href: '/docs/plugins' },
    ],
  },
  {
    title: 'Engine & data',
    cards: [
      { title: 'Clips & Tracks', desc: 'Multiple video tracks, speed, crop, corner radius, protected and pinned tracks.', href: '/docs/clips' },
      { title: 'Frame Sequences', desc: '360 degree orbits and image sets as controllable, editable, exportable media.', href: '/docs/frame-sequences' },
      { title: 'Project Documents', desc: 'readProjectDocument, versioning, relinking media and library snapshots.', href: '/docs/project-documents' },
      { title: 'API Reference', desc: 'TimelineEngine, PlaybackEngine, resolveTimeline, GpuRenderer, hooks and types.', href: '/docs/api' },
    ],
  },
  {
    title: 'Motion',
    cards: [
      { title: 'Motion', desc: 'Keyframes, easing, springs, expressions, text animators, stagger and motion paths. Every key is plain data.', href: '/docs/motion' },
      { title: 'HTML scenes & VideoSpec', desc: 'Live in 1.0: write a scene as code and convert it to native clips and keyframes.', href: '/docs/scenes' },
    ],
  },
  {
    title: 'Render & ship',
    cards: [
      { title: 'Export', desc: 'Render a project to MP4 in the browser with exportVideo().', href: '/docs/export' },
      { title: 'CLI & Server', desc: 'Render headlessly: build specs, elah serve, Docker self-hosting.', href: '/docs/cli' },
    ],
  },
  {
    title: 'For agents',
    cards: [
      { title: 'For AI Agents', desc: 'The one-file integration guide, AGENTS.md, headless rendering and llms.txt.', href: '/docs/agents' },
      { title: 'WebMCP', desc: 'Planned: the engine as tools for ChatGPT and Claude Code. Coming soon.', href: '/docs/agents#webmcp' },
    ],
  },
]
