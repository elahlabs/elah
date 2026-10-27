import type { Metadata } from 'next'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'
import { PageHeader } from '@/components/site/PageHeader'
import { label } from '@/components/eb'

export const metadata: Metadata = {
  title: 'Theming',
  description:
    'Re-skin the editor with the --elah-* CSS variables: the three stylesheets, the elah-root scope, the 0.6.0 overlay, spinner, clip-badge and toast tokens, the classNames slot API, and the deprecated timelineTheme.',
  alternates: { canonical: '/docs/theming' },
}

const toc = [
  { id: 'tokens', title: 'Design Tokens', level: 2 },
  { id: 'overlay-tokens', title: 'Overlay Tokens (0.6.0)', level: 2 },
  { id: 'class-names', title: 'The classNames Prop', level: 2 },
  { id: 'timeline-theme', title: 'timelineTheme (Deprecated)', level: 2 },
]

const GROUPS: Array<[string, string]> = [
  ['bg, bg-secondary, bg-panel, bg-card, bg-elevated, bg-highest', 'Structural surfaces: canvas, lanes, panels, cards, menus, chips'],
  ['border, border-subtle, outline', 'Hairlines and interactive or focus edges'],
  ['text, text-muted, text-on-clip', 'Foreground text, and the label on a coloured clip'],
  ['accent, accent-hover, accent-dim, accent-glow, accent-soft, accent-text', 'The primary accent and its variants'],
  ['clip-{video,audio,text,image,shape,freehand}-{top,mid,bottom,accent}', 'Per-clip-type gradient ramp and accent'],
  ['tag-*', 'Asset and element kind chips (foreground and background per kind)'],
  ['playhead, tick-color, tick-label', 'Playhead needle, ruler ticks and labels'],
  ['selection-border, selection-glow', 'Selected-clip highlight'],
  ['transition-*', 'Cut line and diamond marker states'],
  ['menu-*, popover-*, dialog-*', 'Context menu, transition picker popover, blocking dialog'],
  ['danger-*, color-error, info-*', 'Destructive actions, error text, informational toast'],
  ['effect-*', 'Reusable glosses, inset highlights, scrims and drop shadows'],
  ['preview-bg, stage-border, stage-glow, selection-color, selection-handle', 'Preview canvas and the media-transform overlay affordances'],
]

const NEW_TOKENS: Array<[string, string, string]> = [
  ['--elah-overlay-scrim', 'rgba(0, 0, 0, 0.7)', 'Full-stage scrim: the GL-context recovery layer and the loading error label'],
  ['--elah-overlay-text', '#ffffff', 'Text drawn on that scrim'],
  ['--elah-overlay-border', 'rgba(255, 255, 255, 0.3)', 'Ghost button drawn on the scrim (Reload preview)'],
  ['--elah-overlay-bg', 'rgba(255, 255, 255, 0.1)', 'Ghost button fill'],
  ['--elah-overlay-bg-hover', 'rgba(255, 255, 255, 0.2)', 'Ghost button fill on hover'],
  ['--elah-spinner-track', 'rgba(255, 255, 255, 0.25)', 'Preview loading spinner ring'],
  ['--elah-spinner-head', 'rgba(255, 255, 255, 0.9)', 'Spinner leading arc'],
  ['--elah-clip-badge-bg', 'rgba(0, 0, 0, 0.55)', 'Backing pill for small clip badges, such as the speed badge'],
  ['--elah-toast-shadow', '0 4px 12px rgba(0, 0, 0, 0.35)', 'Drop shadow under the asset and source panel toasts'],
]

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

export default function ThemingPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        <PageHeader
          variant="doc"
          eyebrow="Build the editor"
          title="Theming"
          lede={
            <>
              Every colour, border, shadow and overlay in the editor UI flows through one contract: the <C>--elah-*</C> CSS variables. Re-skinning means overriding those variables in one place.
            </>
          }
        />

        {/* Tokens */}
        <section className="mb-10">
          <H2 id="tokens">Design Tokens</H2>
          <P>
            Components never inline colour literals. They use a Tailwind token class or a <C>var(--elah-*)</C> reference. Whoever defines <C>--elah-*</C> decides the editor&apos;s look, and the variables are scoped to an element with the <C>elah-root</C> class, so wrap the editor in one.
          </P>
          <P>
            Import all three stylesheets once at your app root. Each package compiles only the classes its own components use, so they do not contain each other&apos;s rules. The compiled files are plain CSS with preflight off: you do not need Tailwind, and no utility class names such as <C>.flex</C> or <C>.p-2</C> are exposed.
          </P>
          <CodeBlock
            language="tsx"
            code={`import '@elah/timeline/styles.css'        // compiled timeline rules
import '@elah/editor/styles.css'          // compiled editor rules
import '@elah/editor/styles/tokens.css'   // --elah-* values (dark defaults)

<EditorProvider fps={30}>
  {/* elah-root scopes the --elah-* tokens */}
  <div className="elah-root" style={{ height: '100vh' }}>
    {/* AssetPanel, Preview, Timeline ... */}
  </div>
</EditorProvider>`}
          />
          <P>
            Skipping the tokens file is valid when your app already defines <C>.elah-root</C> itself. Override any variable in your own <C>.elah-root</C> scope:
          </P>
          <CodeBlock
            language="css"
            code={`.elah-root {
  --elah-accent:   #6366f1;   /* indigo brand */
  --elah-bg-panel: #1e1e2e;
  --elah-playhead: #f43f5e;
}`}
          />
          <P>
            You can also map the variables onto your own tokens, for example <C>{'--elah-bg-panel: var(--color-surface-low)'}</C>, so the editor follows your app&apos;s light and dark theme automatically. The components are identical in every case. Only the values differ. The full variable list is the public theming surface, in <C>packages/editor/src/styles/tokens.css</C>, and the repository&apos;s <C>docs/design-tokens.md</C> documents the groups. Every name below is prefixed with <C>--elah-</C>:
          </P>
          <div className="overflow-hidden border border-outline-variant">
            {GROUPS.map(([names, purpose], i) => (
              <div
                key={names}
                className={`flex flex-col gap-1 border-b border-outline-variant p-3 last:border-0 sm:flex-row sm:items-start sm:gap-4 ${i % 2 === 0 ? 'bg-surface-low' : 'bg-surface-lowest'}`}
              >
                <code className="font-mono text-2xs text-on-surface sm:w-80 sm:shrink-0 break-words">{names}</code>
                <div className="text-xs leading-relaxed text-on-surface-variant">{purpose}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Overlay tokens */}
        <section className="mb-10">
          <H2 id="overlay-tokens">Overlay Tokens (0.6.0)</H2>
          <P>
            Before 0.6.0 the preview overlays and clip badges used hard-coded colours and could not be themed. They now read these variables. The values below are the standalone defaults from <C>tokens.css</C>.
          </P>
          <div className="mb-4 overflow-x-auto border border-outline-variant bg-surface-low p-4">
            <table className="w-full min-w-[34rem] text-xs">
              <thead>
                <tr className="border-b border-outline-variant">
                  <th className={`${label} pb-2 text-left font-normal text-on-surface-variant`}>Variable</th>
                  <th className={`${label} pb-2 text-left font-normal text-on-surface-variant`}>Default</th>
                  <th className={`${label} pb-2 text-left font-normal text-on-surface-variant`}>Used for</th>
                </tr>
              </thead>
              <tbody className="text-on-surface-variant">
                {NEW_TOKENS.map(([name, value, use]) => (
                  <tr key={name} className="border-b border-outline-variant last:border-0">
                    <td className="py-2 pr-3 font-mono text-on-surface">{name}</td>
                    <td className="py-2 pr-3 font-mono">{value}</td>
                    <td className="py-2">{use}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock
            language="css"
            code={`.elah-root {
  --elah-overlay-scrim:  rgba(10, 12, 20, 0.8);
  --elah-spinner-head:   #7dd3fc;
  --elah-clip-badge-bg:  rgba(0, 0, 0, 0.7);
}`}
          />
        </section>

        {/* classNames */}
        <section className="mb-10">
          <H2 id="class-names">The classNames Prop</H2>
          <P>
            Tokens recolour every editor instance. For a single component, pass <C>classNames</C>: a per-slot map of Tailwind class strings that wins over the built-in classes for the same CSS property. <C>&lt;Timeline&gt;</C> takes a <C>TimelineClassNames</C> and <C>&lt;SourcePanel&gt;</C> takes a <C>SourcePanelClassNames</C>. The bare <C>className</C> prop is shorthand for <C>classNames.root</C>, merged after it.
          </P>
          <CodeBlock
            language="tsx"
            code={`import { Timeline } from '@elah/editor'

<Timeline
  classNames={{
    root:            'rounded-xl',
    ruler:           'bg-zinc-900',                // ruler strip
    rulerTick:       'bg-zinc-600',                // tick marks
    rulerLabel:      'text-zinc-400',              // timecode labels
    lane:            'bg-zinc-950',
    clip:            'rounded-2xl shadow-lg',      // clip shape, all types
    clipVideo:       'from-sky-400 to-sky-600',    // video clip body
    clipVideoAccent: 'text-sky-300',               // its stripe and track bar
    playhead:        'text-cyan-400',              // a TEXT colour, see below
  }}
/>`}
          />
          <P>
            The slots are <C>root</C>, <C>ruler</C>, <C>rulerTick</C>, <C>rulerLabel</C>, <C>track</C>, <C>trackLabel</C>, <C>lane</C>, <C>clip</C>, <C>clipVideo</C>, <C>clipAudio</C>, <C>clipText</C>, <C>clipImage</C>, <C>clipVideoAccent</C>, <C>clipAudioAccent</C>, <C>clipTextAccent</C>, <C>clipImageAccent</C> and <C>playhead</C>. Use <C>bg-*</C> classes or gradients to recolour surfaces and clip bodies. Use <C>text-*</C> to recolour accents: the playhead, clip stripe and border, and track-label bar all paint from <C>currentColor</C>.
          </P>
          <P>
            Overrides win because of <C>cn</C>, exported from <C>@elah/timeline</C> (and from <C>@elah/editor</C>). It is <C>clsx</C> plus <C>tailwind-merge</C>, so a later class reliably beats an earlier one for the same property. Plain concatenation would leave both in the list and let CSS source order decide. Use it for your own components too:
          </P>
          <CodeBlock
            language="tsx"
            code={`import { cn } from '@elah/timeline'

<div className={cn('rounded border p-2', props.className)} />`}
          />
        </section>

        {/* timelineTheme */}
        <section className="mb-10">
          <H2 id="timeline-theme">timelineTheme (Deprecated)</H2>
          <P>
            <C>timelineTheme</C> is a backward-compatibility facade, marked <C>@deprecated</C>, and scheduled for removal in a future major release. Its values now point at the <C>--elah-*</C> variable contract rather than raw hex literals, for example <C>timelineTheme.surface.background</C> is <C>&apos;var(--elah-bg-secondary)&apos;</C>. Components no longer consume it internally.
          </P>
          <P>
            For global theming, override the <C>--elah-*</C> properties on <C>.elah-root</C>. For per-instance changes, use the <C>classNames</C> prop. Migrate off <C>timelineTheme</C> to either.
          </P>
        </section>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
