import type { Metadata } from 'next'
import { DocsToc } from '@/components/docs/DocsToc'
import { Code } from '@/components/docs/Code'
import { C, Callout, DocsPager, H2, H3, P, PropTable } from '@/components/docs/DocsKit'
import { TokenPalette } from '@/components/docs/TokenPalette'
import { PageHeader } from '@/components/site/PageHeader'

export const metadata: Metadata = {
  title: 'Theming',
  description:
    'Re-skin the editor with the --elah-* CSS variables: the three stylesheets, the elah-root scope, the overlay, spinner, clip-badge and toast tokens, the classNames slot API, and the deprecated timelineTheme.',
  alternates: { canonical: '/docs/theming' },
}

const toc = [
  { id: 'tokens', title: 'Design tokens', level: 2 },
  { id: 'overlay-tokens', title: 'Overlay tokens', level: 2 },
  { id: 'class-names', title: 'The classNames prop', level: 2 },
  { id: 'timeline-theme', title: 'timelineTheme (deprecated)', level: 2 },
]

export default function ThemingPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          eyebrow="Build the editor"
          title="Theming"
          lede="Every colour, border and shadow in the editor comes from one set of CSS variables, --elah-*. Change them in one place and every component follows."
        />

        <H2 id="tokens">Design tokens</H2>
        <P>Import the three stylesheets once, and wrap the editor in an element with the <C>elah-root</C> class:</P>
        <Code
          highlight={[3, 6]}
          code={`
import '@elah/timeline/styles.css'      // timeline rules
import '@elah/editor/styles.css'        // editor rules
import '@elah/editor/styles/tokens.css' // the --elah-* default values

<EditorProvider fps={30}>
  <div className="elah-root" style={{ height: '100vh' }}>
    {/* AssetPanel, Preview, Timeline… */}
  </div>
</EditorProvider>`}
        />
        <Callout title="No Tailwind needed">
          The stylesheets are plain CSS. They only contain the rules the components use, with no global reset and no utility classes such as{' '}
          <C>.flex</C> leaking into your app.
        </Callout>
        <P>Then override any variable in your own <C>.elah-root</C> rule:</P>
        <Code
          lang="css"
          code={`
.elah-root {
  --elah-accent: #6366f1;   /* indigo brand */
  --elah-bg-panel: #1e1e2e;
  --elah-playhead: #f43f5e;
}`}
        />
        <P>
          Or point them at your app&apos;s own variables, such as <C>--elah-bg-panel: var(--color-surface-low)</C>, and the editor follows your
          light and dark themes automatically. If your app already defines every <C>--elah-*</C> value on <C>.elah-root</C>, you can skip{' '}
          <C>tokens.css</C>.
        </P>
        <TokenPalette />
        <H3>All the groups</H3>
        <P>
          Every name below starts with <C>--elah-</C>. The complete list is <C>packages/editor/src/styles/tokens.css</C>, and{' '}
          <C>docs/design-tokens.md</C> in the repository describes each group.
        </P>
        <PropTable
          nameLabel="Tokens"
          rows={[
            { name: 'bg · bg-secondary · bg-panel · bg-card · bg-elevated · bg-highest', desc: 'Surfaces: canvas, lanes, panels, cards, menus, chips.' },
            { name: 'border · border-subtle · outline', desc: 'Hairlines, and interactive or focus edges.' },
            { name: 'text · text-muted · text-on-clip', desc: 'Text, and the label on a coloured clip.' },
            { name: 'accent · accent-hover · accent-dim · accent-glow · accent-soft · accent-text', desc: 'The main accent and its variants.' },
            { name: 'clip-{type}-{top,mid,bottom,accent}', desc: 'Each clip type’s gradient and accent, for video, audio, text, image, shape and freehand.' },
            { name: 'tag-*', desc: 'Chips that label asset and element kinds.' },
            { name: 'playhead · tick-color · tick-label', desc: 'Playhead, ruler ticks and timecodes.' },
            { name: 'selection-border · selection-glow', desc: 'A selected clip.' },
            { name: 'transition-*', desc: 'The cut line and the transition diamond.' },
            { name: 'menu-* · popover-* · dialog-*', desc: 'Context menu, transition picker, blocking dialog.' },
            { name: 'danger-* · color-error · info-*', desc: 'Destructive actions, errors, informational toasts.' },
            { name: 'effect-*', desc: 'Glosses, inset highlights, scrims and shadows.' },
            { name: 'preview-bg · stage-border · stage-glow · selection-color · selection-handle', desc: 'The preview canvas and the on-canvas transform handles.' },
          ]}
        />

        <H2 id="overlay-tokens">Overlay tokens</H2>
        <P>The preview&apos;s loading and error overlays, the spinner, clip badges and toasts have their own variables:</P>
        <PropTable
          nameLabel="Token"
          rows={[
            { name: '--elah-overlay-scrim', type: 'rgba(0, 0, 0, 0.7)', desc: 'The full-preview dimming layer, shown when the preview needs a reload or media fails to load.' },
            { name: '--elah-overlay-text', type: '#ffffff', desc: 'Text on that layer.' },
            { name: '--elah-overlay-border · -bg · -bg-hover', type: 'rgba(255, 255, 255, 0.3 · 0.1 · 0.2)', desc: 'The “Reload preview” button on it.' },
            { name: '--elah-spinner-track · -head', type: 'rgba(255, 255, 255, 0.25 · 0.9)', desc: 'The loading spinner’s ring and moving arc.' },
            { name: '--elah-clip-badge-bg', type: 'rgba(0, 0, 0, 0.55)', desc: 'The pill behind small clip badges, such as speed.' },
            { name: '--elah-toast-shadow', type: '0 4px 12px rgba(0, 0, 0, 0.35)', desc: 'The shadow under panel toasts.' },
          ]}
        />
        <Code
          lang="css"
          code={`
.elah-root {
  --elah-overlay-scrim: rgba(10, 12, 20, 0.8);
  --elah-spinner-head: #7dd3fc;
  --elah-clip-badge-bg: rgba(0, 0, 0, 0.7);
}`}
        />

        <H2 id="class-names">The classNames prop</H2>
        <P>
          Tokens change every editor on the page. To restyle one component, pass <C>classNames</C>: Tailwind classes per part, which win over the
          built-in classes for the same property.
        </P>
        <Code
          highlight={[9, 10, 11]}
          code={`
import { Timeline } from '@elah/editor'

<Timeline
  classNames={{
    root: 'rounded-xl',
    ruler: 'bg-zinc-900',
    lane: 'bg-zinc-950',
    clip: 'rounded-2xl shadow-lg',
    clipVideo: 'from-sky-400 to-sky-600', // the clip body
    clipVideoAccent: 'text-sky-300',      // its stripe: a text colour
    playhead: 'text-cyan-400',            // also a text colour
  }}
/>`}
        />
        <PropTable
          nameLabel="Slots"
          rows={[
            { name: 'root · ruler · rulerTick · rulerLabel', desc: 'The whole timeline and its ruler. className is shorthand for classNames.root.' },
            { name: 'track · trackLabel · lane', desc: 'A track row, its label, and the area clips sit in.' },
            { name: 'clip · clipVideo · clipAudio · clipText · clipImage', desc: 'All clips, or one type’s body. Use bg-* or gradient classes.' },
            { name: 'clipVideoAccent · clipAudioAccent · clipTextAccent · clipImageAccent', desc: 'A type’s stripe, border and track bar. Use text-*.' },
            { name: 'playhead', desc: 'Use text-*.' },
          ]}
        />
        <Callout kind="warning" title="Accents and the playhead take text-* classes, not bg-*">
          They are painted with <C>currentColor</C>, so a text colour sets them. A <C>bg-*</C> class does nothing there.
        </Callout>
        <P>
          <C>SourcePanel</C> takes <C>SourcePanelClassNames</C> the same way. Overrides win because classes are merged with <C>cn</C> (
          <C>clsx</C> plus <C>tailwind-merge</C>), so a later class beats an earlier one for the same property. It is exported from{' '}
          <C>@elah/timeline</C> and <C>@elah/editor</C> for your own components:
        </P>
        <Code
          code={`
import { cn } from '@elah/timeline'

<div className={cn('rounded border p-2', props.className)} />`}
        />

        <H2 id="timeline-theme">timelineTheme (deprecated)</H2>
        <Callout kind="warning" title="Will be removed in a future major release">
          <C>timelineTheme</C> is only kept for older code; the components no longer read it. Its values are now <C>--elah-*</C> references, such
          as <C>timelineTheme.surface.background === &apos;var(--elah-bg-secondary)&apos;</C>. Move to the variables for global changes, or{' '}
          <C>classNames</C> for one component.
        </Callout>

        <DocsPager href="/docs/theming" />
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
