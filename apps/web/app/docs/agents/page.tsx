import type { Metadata } from 'next'
import Link from 'next/link'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'
import { PageHeader } from '@/components/site/PageHeader'

export const metadata: Metadata = {
  title: 'For AI Agents',
  description:
    'How AI coding agents and generating models work with elah today: the single-file integration guide, AGENTS.md, headless rendering with the CLI, llms.txt, and the planned WebMCP tools.',
  alternates: { canonical: '/docs/agents' },
}

const toc = [
  { id: 'one-file-guide', title: 'The One-File Guide', level: 2 },
  { id: 'agents-in-the-repo', title: 'Agents in the Repo', level: 2 },
  { id: 'headless-rendering', title: 'Headless Rendering', level: 2 },
  { id: 'llms-txt', title: 'llms.txt', level: 2 },
  { id: 'webmcp', title: 'WebMCP', level: 2 },
]

const GUIDE_URL = 'https://raw.githubusercontent.com/elahlabs/elah/main/docs/ai/ELAH_FOR_AI_AGENTS.md'
const AGENTS_MD_URL = 'https://github.com/elahlabs/elah/blob/main/AGENTS.md'

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="mb-4 text-xl font-semibold tracking-tight text-on-surface scroll-mt-28 md:scroll-mt-20"
    >
      {children}
    </h2>
  )
}

function C({ children }: { children: React.ReactNode }) {
  return <code className="bg-surface-container px-1.5 py-0.5 text-xs font-mono">{children}</code>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">{children}</p>
}

export default function AgentsPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        <PageHeader
          variant="doc"
          eyebrow="For agents"
          title="For AI Agents"
          lede={
            <>
              Elah is built so that a model can use it without guessing: time is integer frames, every edit goes through one engine, and the integration surface is written down in one file. This page covers what exists today, and what is planned.
            </>
          }
        />

        {/* One-file guide */}
        <section className="mb-10">
          <H2 id="one-file-guide">The One-File Guide</H2>
          <P>
            <C>docs/ai/ELAH_FOR_AI_AGENTS.md</C> is a single, self-contained integration guide for building a custom video-editor UI on <C>@elah/editor</C>. It holds the full API surface, the three-stylesheet setup, bundler configuration for Vite and Next.js, 12 copy-paste recipes, and a list of common mistakes. Nothing in it requires reading another file.
          </P>
          <P>
            It needs <strong className="text-on-surface font-medium">no repository checkout</strong>, so it works for browser-based builders that get one shot and no filesystem (Lovable, Google AI Studio, Emergent, v0, bolt.new) as well as for repo-aware agents such as Claude Code, Codex, Cursor and Gemini CLI. Paste the raw URL into the prompt, or let the tool fetch it:
          </P>
          <CodeBlock language="text" code={GUIDE_URL} />
          <P>
            If a tool can fetch a URL, the guide also points at three runnable apps that install the same version from npm: a minimal Vite editor of about 130 lines to copy, a finished editor with panels and an MP4 export modal, and a Next.js App Router version.
          </P>
          <P>
            The guide duplicates the API surface by design, so it can go stale silently. When the public API changes, it is updated in the same change as the docs.
          </P>
        </section>

        {/* AGENTS.md */}
        <section className="mb-10">
          <H2 id="agents-in-the-repo">Agents in the Repo</H2>
          <P>
            For an agent working <em>inside</em> a checkout of the repository, rather than consuming the packages, the brief is <a href={AGENTS_MD_URL} target="_blank" rel="noopener noreferrer" className="text-on-surface underline decoration-primary underline-offset-4 hover:decoration-2">AGENTS.md</a> at the repo root. It states the three invariants that hold everywhere, the package layout, the build and test commands, the one build quirk worth knowing (apps resolve <C>@elah/*</C> to <C>dist/</C>, except the website, which resolves to source), the release steps, and what to update when the public API changes.
          </P>
          <ul className="mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>
              <strong className="text-on-surface font-medium">Time is integer frames.</strong> Never compute positions in float seconds. Convert at the edges with <C>secondsToFrames</C> and <C>framesToSeconds</C>.
            </li>
            <li>
              <strong className="text-on-surface font-medium">One mutation funnel.</strong> Every project edit goes through <C>TimelineEngine</C>. The stores are read-only mirrors.
            </li>
            <li>
              <strong className="text-on-surface font-medium">The resolver is pure.</strong> <C>resolveTimeline(frame, project)</C> returns a <C>Scene</C> with no side effects and no I/O, and renderers consume only the scene.
            </li>
          </ul>
        </section>

        {/* Headless */}
        <section className="mb-10">
          <H2 id="headless-rendering">Headless Rendering</H2>
          <P>
            A model that cannot run a browser can still produce video. <C>@elah/cli</C> turns a seconds-based JSON build spec into a project through <C>TimelineEngine</C> and renders it in headless Chrome, using the same export pipeline as the browser. Start the render server and post a spec:
          </P>
          <CodeBlock
            language="bash"
            code={`npx @elah/cli serve --port 8080 --media-root ./assets

curl -X POST --data-binary @spec.json http://127.0.0.1:8080/render -o out.mp4`}
          />
          <P>
            The spec is friendly to generation because it uses seconds, not frames, and names assets rather than paths. Validation is where it helps a model most: overlaps, track limits and source bounds are checked by the real engine, and failures come back as path-addressed messages such as <C>clips[2].duration must be ...</C>. Over HTTP an invalid spec is a <C>422</C> with the message in a JSON <C>error</C> field, so a generating model can read the error, fix that one clip, and resubmit. The spec format, error contract and serve options are documented on <Link href="/docs/cli#build-spec" className="text-on-surface underline decoration-primary underline-offset-4 hover:decoration-2">the CLI page</Link>.
          </P>
        </section>

        {/* llms.txt */}
        <section className="mb-10">
          <H2 id="llms-txt">llms.txt</H2>
          <P>
            Following the llmstxt.org convention, this site publishes two machine-readable files:
          </P>
          <ul className="mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>
              <a href="/llms.txt" className="text-on-surface underline decoration-primary underline-offset-4 hover:decoration-2"><C>/llms.txt</C></a> is a curated index of the docs, resources, blog posts and package links, with a one-line description of each. Retrieval agents can find the canonical pages without scraping HTML.
            </li>
            <li>
              <a href="/llms-full.txt" className="text-on-surface underline decoration-primary underline-offset-4 hover:decoration-2"><C>/llms-full.txt</C></a> concatenates the full markdown of every blog post so it can be ingested in a single fetch. Each post is also available alone at <C>/blog/&lt;slug&gt;/md</C>.
            </li>
          </ul>
          <P>
            Both are generated from the same registries as the sidebar and sitemap, so a new docs page shows up in them automatically once it is registered.
          </P>
        </section>

        {/* WebMCP */}
        <section className="mb-10">
          <H2 id="webmcp">WebMCP</H2>

          <div className="mb-6 border border-outline-variant bg-surface-low p-4">
            <div className="label-mono mb-1 text-2xs text-on-surface">Status</div>
            <p className="text-sm leading-relaxed text-on-surface">
              <strong className="font-medium">Planned. Coming soon, with ChatGPT and Claude Code as the target clients.</strong>
            </p>
            <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
              There is no WebMCP code in the elah repository today. Nothing on this page describes something you can install or call yet.
            </p>
          </div>

          <P>
            <strong className="text-on-surface font-medium">What it is.</strong> WebMCP is a proposal from the W3C Web Machine Learning Community Group, from Google and Microsoft. A web page registers tools with <C>document.modelContext.registerTool()</C> (it was <C>navigator.modelContext</C> until August 2026), and each tool declares its arguments with JSON Schema. An AI agent that is browsing the page can then discover those tools and call them directly, instead of scraping the DOM or guessing at clicks.
          </P>
          <P>
            <strong className="text-on-surface font-medium">Where it stands.</strong> Chrome shipped it in Canary 146 and ran an origin trial from Chrome 149. ChatGPT&apos;s desktop browser and Codex can discover WebMCP tools on a page, and Claude Code reaches them through an MCP bridge. Firefox and Safari are engaged but have not committed. It is a proposal, so details may still change.
          </P>
          <P>
            <strong className="text-on-surface font-medium">What elah plans to expose.</strong> The plan is to expose the engine as WebMCP tools over <C>TimelineEngine</C>, in three groups:
          </P>
          <ul className="mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>
              <strong className="text-on-surface font-medium">Describing the project:</strong> let an agent read the state of the project.
            </li>
            <li>
              <strong className="text-on-surface font-medium">Applying edits:</strong> let an agent change the timeline through the engine.
            </li>
            <li>
              <strong className="text-on-surface font-medium">Exporting:</strong> let an agent render the result.
            </li>
          </ul>
          <P>
            <strong className="text-on-surface font-medium">Why a timeline is a good tool surface.</strong> Three properties of the engine do most of the work:
          </P>
          <ul className="mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>
              <strong className="text-on-surface font-medium">Time is integer frames.</strong> A tool argument such as a start frame or a duration is unambiguous. There are no float-second rounding questions for a model to get wrong.
            </li>
            <li>
              <strong className="text-on-surface font-medium">Every mutation goes through one funnel.</strong> All edits pass through <C>TimelineEngine</C>, so there is exactly one place for a tool to call, and one place that validates it.
            </li>
            <li>
              <strong className="text-on-surface font-medium">Each op is undoable.</strong> An agent&apos;s edit lands on the same undo stack as a human one, and a group of operations can be applied as a single step with <C>engine.batch()</C>. A person watching an agent edit can reverse it with one undo.
            </li>
          </ul>
          <P>
            Until then, the paths above (the one-file guide, <C>AGENTS.md</C>, the CLI, and <C>llms.txt</C>) are how agents work with elah.
          </P>
        </section>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
