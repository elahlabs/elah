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
]
