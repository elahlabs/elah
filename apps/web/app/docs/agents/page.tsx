import type { Metadata } from 'next'
import Link from 'next/link'
import { DocsToc } from '@/components/docs/DocsToc'
import { Code } from '@/components/docs/Code'
import { C, Callout, DocsPager, H2, H3, P, PropTable } from '@/components/docs/DocsKit'
import { PageHeader } from '@/components/site/PageHeader'

export const metadata: Metadata = {
  title: 'For AI Agents',
  description:
    'How AI coding agents and generating models work with elah today: the single-file integration guide, AGENTS.md, headless rendering with the CLI, llms.txt, and the planned WebMCP tools.',
  alternates: { canonical: '/docs/agents' },
}

const toc = [
  { id: 'which', title: 'Which path?', level: 2 },
  { id: 'one-file-guide', title: 'The one-file guide', level: 2 },
  { id: 'agents-in-the-repo', title: 'Agents in the repo', level: 2 },
  { id: 'headless-rendering', title: 'Headless rendering', level: 2 },
  { id: 'llms-txt', title: 'llms.txt', level: 2 },
  { id: 'webmcp', title: 'WebMCP (planned)', level: 2 },
]

const GUIDE_URL = 'https://raw.githubusercontent.com/elahlabs/elah/main/docs/ai/ELAH_FOR_AI_AGENTS.md'
const AGENTS_MD_URL = 'https://github.com/elahlabs/elah/blob/main/AGENTS.md'
const link = 'text-on-surface underline decoration-[#FF003C] underline-offset-4 hover:decoration-2'

export default function AgentsPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          eyebrow="For agents"
          title="For AI Agents"
          lede="elah is built so a model can use it without guessing: time is whole frames, every edit goes through one engine, and the whole integration is written down in one file."
        />
        <Callout title="Every docs page has an Ask AI button">
          The button at the top right of each page copies a prompt that points an assistant at that page and <C>/llms.txt</C>, or opens it in
          Claude Code, Codex or OpenCode.
        </Callout>

        <H2 id="which">Which path?</H2>
        <PropTable
          nameLabel="If the agent is…"
          rows={[
            { name: 'Building an app on elah', desc: <>Give it <a href="#one-file-guide" className={link}>the one-file guide</a>. No checkout needed.</> },
            { name: 'Working inside the elah repo', desc: <>It should read <a href="#agents-in-the-repo" className={link}>AGENTS.md</a>.</> },
            { name: 'Generating videos, no browser', desc: <>Post a JSON spec to the <a href="#headless-rendering" className={link}>render server</a>.</> },
            { name: 'Looking things up', desc: <><a href="#llms-txt" className={link}>/llms.txt</a> indexes the docs pages.</> },
          ]}
        />

        <H2 id="one-file-guide">The one-file guide</H2>
        <P>
          <C>docs/ai/ELAH_FOR_AI_AGENTS.md</C> is a single, self-contained guide to building a video editor on <C>@elah/editor</C>. Nothing in it
          requires reading another file, so it works for one-shot browser builders with no filesystem (Lovable, Google AI Studio, v0, bolt.new)
          as well as for Claude Code, Codex, Cursor and Gemini CLI. Paste the URL into the prompt, or let the tool fetch it:
        </P>
        <Code lang="text" code={GUIDE_URL} />
        <PropTable
          nameLabel="Section"
          rows={[
            { name: 'Setup', desc: 'Install, the three stylesheets (the most common mistake), and Vite and Next.js configuration.' },
            { name: 'Mental model & API', desc: 'How the pieces fit, then the full public API.' },
            { name: '12 recipes', desc: 'Minimal editor, transport bar, undo, clip inspector, importing media, text, split, export with progress, aspect ratio, save and load, theming, batched edits.' },
            { name: 'Common mistakes', desc: 'What agents get wrong most, with the fix.' },
            { name: 'Headless & generation', desc: 'The CLI, VideoSpec and HTML scene worked examples, and editing with ops.' },
          ]}
        />
        <P>
          It also points at three runnable apps that install from npm: a minimal Vite editor of about 130 lines, a finished editor with panels
          and MP4 export, and a Next.js App Router version (<C>examples/</C> in the repo).
        </P>
        <Callout kind="warning" title="It repeats the API on purpose">
          So it can go stale silently. Whenever the public API changes, the guide is updated in the same change as these docs.
        </Callout>

        <H2 id="agents-in-the-repo">Agents in the repo</H2>
        <P>
          For an agent working <em>inside</em> a checkout of elah, the brief is{' '}
          <a href={AGENTS_MD_URL} target="_blank" rel="noopener noreferrer" className={link}>
            AGENTS.md
          </a>{' '}
          at the repo root: the package layout, build and test commands, release steps, what to update when the public API changes, and three
          rules that hold everywhere:
        </P>
        <PropTable
          nameLabel="Rule"
          rows={[
            { name: 'Time is whole frames', desc: <>Never compute positions in seconds. Convert at the edges with <C>secondsToFrames</C> and <C>framesToSeconds</C>.</> },
            { name: 'One mutation funnel', desc: <>Every edit goes through <C>TimelineEngine</C>. The stores are read-only copies.</> },
            { name: 'The resolver is pure', desc: <><C>resolveTimeline(frame, project)</C> has no side effects; renderers read only the Scene it returns.</> },
          ]}
        />
        <Callout title="The build quirk worth knowing">
          Apps import <C>@elah/*</C> from each package&apos;s built <C>dist/</C>, so editing package source needs <C>npm run build:packages</C>.
          The website is the exception: it reads package source directly.
        </Callout>

        <H2 id="headless-rendering">Headless rendering</H2>
        <P>
          A model that cannot run a browser can still make video. <C>@elah/cli</C> turns a JSON spec into a project and renders it in headless
          Chrome with the same pipeline as the browser:
        </P>
        <Code
          lang="bash"
          code={`
npx @elah/cli serve --port 8080 --media-root ./assets

curl -X POST --data-binary @spec.json http://127.0.0.1:8080/render -o out.mp4`}
        />
        <H3>Why the spec suits a model</H3>
        <PropTable
          nameLabel="Property"
          rows={[
            { name: 'Seconds and names', desc: 'Times are in seconds and media is referred to by name, which is how a model naturally writes.' },
            { name: 'Real validation', desc: 'Overlaps, track limits and source bounds are checked by the actual engine, not a schema.' },
            { name: 'Errors it can act on', desc: <>An invalid spec returns <C>422</C> with a message that names the field, such as <C>clips[2].duration must be …</C>. The model fixes that clip and resubmits.</> },
          ]}
        />
        <P>
          The spec format and server options are on{' '}
          <Link href="/docs/cli#build-spec" className={link}>
            the CLI page
          </Link>
          ; the richer VideoSpec and HTML scene formats are on{' '}
          <Link href="/docs/scenes" className={link}>
            HTML scenes &amp; VideoSpec
          </Link>
          .
        </P>

        <H2 id="llms-txt">llms.txt</H2>
        <P>Following the llmstxt.org convention, the site publishes two plain-text files for agents:</P>
        <PropTable
          nameLabel="File"
          rows={[
            { name: '/llms.txt', desc: 'An index of the docs, resources, blog posts and packages, with one line about each, so agents find the right page without scraping HTML.' },
            { name: '/llms-full.txt', desc: <>The full markdown of every <strong>blog post</strong> in one fetch. Each post is also at <C>/blog/&lt;slug&gt;/md</C>. Docs pages are not included.</> },
          ]}
        />
        <Callout kind="warning" title="Adding a docs page? Register it by hand">
          <C>llms.txt</C> and the sitemap are separate hand-kept lists, not generated from the sidebar. Add a new page to <C>DOCS</C> in{' '}
          <C>app/llms.txt/route.ts</C> and to <C>app/sitemap.ts</C>.
        </Callout>

        <H2 id="webmcp">WebMCP (planned)</H2>
        <Callout kind="warning" title="Not built yet">
          There is no WebMCP code in the elah repository today. Nothing in this section can be installed or called yet. The target clients are
          ChatGPT and Claude Code.
        </Callout>
        <P>
          WebMCP is a proposal from the W3C Web Machine Learning Community Group. A page registers tools with{' '}
          <C>document.modelContext.registerTool()</C>, each with a JSON Schema for its arguments, and an agent browsing the page calls them
          directly instead of scraping the DOM or guessing at clicks. Chrome has shipped it behind a trial; Firefox and Safari have not committed.
          Details may still change.
        </P>
        <P>The plan is to expose the engine as tools in three groups:</P>
        <PropTable
          nameLabel="Group"
          rows={[
            { name: 'Describe', desc: 'Read the project: tracks, clips, timing.' },
            { name: 'Edit', desc: 'Change the timeline through the engine.' },
            { name: 'Export', desc: 'Render the result.' },
          ]}
        />
        <Callout title="Why a timeline makes a good tool surface">
          Frame numbers are unambiguous arguments. There is exactly one place to call and validate (<C>TimelineEngine</C>). And every agent edit
          lands on the same undo stack as a human&apos;s, so a group of operations batched with <C>engine.batch()</C> can be reversed with one
          undo.
        </Callout>

        <DocsPager href="/docs/agents" />
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
