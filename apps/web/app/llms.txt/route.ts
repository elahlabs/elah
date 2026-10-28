import { siteConfig } from '@/config/site'
import { posts } from '../blog/posts'

/**
 * Generates /llms.txt — a curated, LLM-friendly index of the site's docs, per
 * the llmstxt.org convention. Retrieval agents (ChatGPT, Perplexity, Claude,
 * IDE doc fetchers) read this to find the canonical pages without scraping HTML.
 *
 * Kept as a route (not a static file) so it derives from `siteConfig` and the
 * one page list below — the same reason `robots.ts`/`sitemap.ts` are routes.
 * When you add a docs page, add it to `DOCS` here and to `sitemap.ts`.
 */

interface DocLink {
  title: string
  path: string
  description: string
}

const DOCS: DocLink[] = [
  { title: 'Docs home', path: '/docs', description: 'Overview of the Elah SDK and how its five packages fit together.' },
  { title: 'Installation', path: '/docs/installation', description: 'Install @elah/editor and its peer dependencies.' },
  { title: 'Getting started', path: '/docs/getting-started', description: 'Mount EditorProvider, Preview, and Timeline into a working editor.' },
  { title: 'Timeline', path: '/docs/timeline', description: 'The @elah/timeline UI: tracks, clips, ruler, playhead, drag/trim, zoom, clip virtualization, multiple video tracks.' },
  { title: 'Editor', path: '/docs/editor', description: 'The @elah/editor SDK: EditorProvider, Preview, AssetPanel, transform overlays with crop, text overlays, transitions.' },
  { title: 'Clips & tracks', path: '/docs/clips', description: 'Multiple video tracks, Clip.speed, Clip.crop, Clip.cornerRadius, protected and pinned tracks, growClipToAssetDuration.' },
  { title: 'Text templates & motion', path: '/docs/text-templates-and-motion', description: 'Layered MotionSpec animation, easings, sampleTextAnimation, the 14 built-in text templates, applyTextTemplate, text style presets.' },
  { title: 'Motion', path: '/docs/motion', description: 'Keyframes on every transform channel, easing and springs, expressions, text animators, stagger, motion paths, motion presets. Keys are plain data with ids.' },
  { title: 'HTML scenes & VideoSpec', path: '/docs/scenes', description: 'Experimental: HTML + CSS scenes (@elah/core/html) and VideoSpec JSON (@elah/core/spec) that convert to native clips and keyframes.' },
  { title: 'Frame sequences', path: '/docs/frame-sequences', description: 'Ordered image sets (360 degree orbits, storyboards): createFrameSequence, FrameSequenceController, createFramePreloader, frameSequenceToProject.' },
  { title: 'Project documents', path: '/docs/project-documents', description: 'readProjectDocument, ProjectDocumentError, PROJECT_VERSION, relinkProjectMedia, loadProject options, media library snapshots.' },
  { title: 'Theming', path: '/docs/theming', description: 'The --elah-* design tokens, the elah-root scope, the three stylesheets, the classNames slot API.' },
  { title: '@elah/react', path: '/docs/react', description: 'React bindings: EditorContext, useEditor, store hooks, media library and audio mixer hooks, and using the vanilla stores without React.' },
  { title: 'For AI agents', path: '/docs/agents', description: 'The one-file integration guide, AGENTS.md, headless rendering with @elah/cli, llms.txt, and the planned WebMCP tools (coming soon, not shipped).' },
  { title: 'Export', path: '/docs/export', description: 'Render a project to MP4 with exportVideo (worker + OffscreenCanvas + mediabunny). outputHeight is the stage short edge.' },
  { title: 'CLI & Server', path: '/docs/cli', description: 'The @elah/cli headless runtime: build specs, one-shot exports, and elah serve — a self-hosted HTTP render server with bit-identical output.' },
  { title: 'Architecture', path: '/docs/architecture', description: 'Engine design: integer frames, the one mutation funnel, pure resolver, dumb renderers.' },
  { title: 'API reference', path: '/docs/api', description: 'Public API surface across @elah/core, @elah/react, @elah/timeline, and @elah/editor.' },
  { title: 'Plugins', path: '/docs/plugins', description: 'Extension points and integration patterns.' },
]

const RESOURCES: DocLink[] = [
  { title: 'Motion', path: '/motion', description: 'Programmatic motion graphics that land as editable clips and keyframes.' },
  { title: 'Elah for Claude', path: '/claude', description: 'The Claude Code plugin and the claude.ai artifact.' },
  { title: 'Motion playground', path: '/playground/motion', description: 'Write a scene as code, convert it to clips and keyframes, export MP4 in the browser.' },
  { title: 'Playgrounds', path: '/playgrounds', description: 'Live, editable examples running the SDK in the browser.' },
  { title: 'Examples', path: '/examples', description: 'Focused code samples for common tasks.' },
  { title: 'Blog', path: '/blog', description: 'Engineering notes and release posts.' },
  { title: 'Changelog', path: '/changelog', description: 'Release history for @elah/core, @elah/react, @elah/timeline, @elah/editor, and @elah/cli.' },
]

// Derived from the blog source of truth so new posts appear automatically.
// Each post links to its raw-markdown variant (/blog/<slug>/md) so agents can
// fetch full content directly instead of scraping the HTML page.
const POSTS: DocLink[] = posts.map((post) => ({
  title: post.title,
  path: `/blog/${post.slug}/md`,
  description: post.excerpt,
}))

const EXTERNAL: DocLink[] = [
  {
    title: 'Elah for AI agents — complete integration guide',
    path: 'https://raw.githubusercontent.com/elahlabs/elah/main/docs/ai/ELAH_FOR_AI_AGENTS.md',
    description:
      'Single self-contained file with the full API surface, bundler setup, 12 copy-paste recipes, and the common mistakes. Written for coding agents building a custom editor UI — start here if you are generating code against this SDK.',
  },
  { title: 'GitHub repository', path: siteConfig.links.github, description: 'Source, ARCHITECTURE.md, and AGENTS.md (the brief for coding agents in the checkout).' },
  { title: '@elah/editor on npm', path: 'https://www.npmjs.com/package/@elah/editor', description: 'The full React editor SDK package.' },
  { title: '@elah/timeline on npm', path: 'https://www.npmjs.com/package/@elah/timeline', description: 'React timeline UI components and hooks.' },
  { title: '@elah/react on npm', path: 'https://www.npmjs.com/package/@elah/react', description: 'React bindings: editor context, store hooks, audio mixer hooks.' },
  { title: '@elah/core on npm', path: 'https://www.npmjs.com/package/@elah/core', description: 'The framework-agnostic headless engine, resolver, renderer, and export pipeline.' },
  { title: '@elah/cli on npm', path: 'https://www.npmjs.com/package/@elah/cli', description: 'Headless CLI and render server: elah build / export / serve, plus a Node library API.' },
]

function section(title: string, links: DocLink[], base: string): string {
  const line = ({ title, path, description }: DocLink) => {
    const url = path.startsWith('http') ? path : `${base}${path}`
    return `- [${title}](${url}): ${description}`
  }
  return `## ${title}\n\n${links.map(line).join('\n')}`
}

export function GET(): Response {
  const base = siteConfig.url

  const body = `# ${siteConfig.name}

> ${siteConfig.description}

Elah is a browser-native, frame-accurate video editing engine: a framework-agnostic
core (timeline engine, pure resolver, WebGL2 renderer, WebCodecs decode, MP4 export)
with React bindings on top, shipped as five packages (@elah/core, @elah/react,
@elah/timeline, @elah/editor and the headless @elah/cli). Time is integer frames; every edit funnels through one
engine; \`resolveTimeline(frame, project) → Scene\` is the pure bridge to any renderer.

For full blog content in one fetch, see ${base}/llms-full.txt. Individual posts are
available as raw markdown at ${base}/blog/<slug>/md.

${section('Documentation', DOCS, base)}

${section('Resources', RESOURCES, base)}

${section('Blog posts', POSTS, base)}

${section('Source & packages', EXTERNAL, base)}
`

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
