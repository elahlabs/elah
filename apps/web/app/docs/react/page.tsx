import type { Metadata } from 'next'
import Link from 'next/link'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'
import { PageHeader } from '@/components/site/PageHeader'

export const metadata: Metadata = {
  title: '@elah/react',
  description:
    'The React bindings for the Elah engine: EditorContext, useEditor, the store hooks, the media library and audio mixer hooks, and how to use the same stores without React.',
  alternates: { canonical: '/docs/react' },
}

const toc = [
  { id: 'install', title: 'Install', level: 2 },
  { id: 'editor-context', title: 'EditorContext', level: 2 },
  { id: 'store-hooks', title: 'Store Hooks', level: 2 },
  { id: 'audio-hooks', title: 'Audio Hooks', level: 2 },
  { id: 'load-and-presets', title: 'Load State & Presets', level: 2 },
  { id: 'without-react', title: 'Without React', level: 2 },
]

const STORES: Array<[string, string, string]> = [
  ['useTracksStore', 'tracksStore', 'tracks, clips, stage, totalFrames, canUndo, canRedo. A read-only mirror of the engine.'],
  ['useTransitionsStore', 'transitionsStore', 'transitions. A read-only mirror of project.transitions.'],
  ['usePlaybackStore', 'playbackStore', 'currentFrame, isPlaying, playbackRate, loop, volume, muted, zoom, snapEnabled, plus the transport actions.'],
  ['useSelectionStore', 'selectionStore', 'selectedClipIds, activeTrackId, plus selectClip, toggleClipSelection, selectClips, clearSelection, setActiveTrack. UI-only state.'],
  ['useMediaLibraryStore', 'mediaLibraryStore', 'assets (by id), order, plus addAsset, removeAsset, updateAsset, getAsset.'],
  ['useClipLoadStore', 'clipLoadStore', 'byClipId: which clips the preview cannot draw yet. Renderer state, never saved.'],
  ['useTextStylePresetsStore', 'textStylePresetsStore', 'presets (the user-saved ones), plus addPreset and removePreset.'],
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

export default function ReactPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        <PageHeader
          variant="doc"
          eyebrow="Build the editor"
          title="@elah/react"
          lede={
            <>
              A thin hook layer over <C>@elah/core</C>. <C>@elah/core</C> has zero React imports and its stores are vanilla, so everything React-specific lives here.
            </>
          }
        />

        {/* Install */}
        <section className="mb-10">
          <H2 id="install">Install</H2>
          <P>
            <C>@elah/react</C> has been its own package since 0.4.0. It depends on <C>@elah/core</C> and <C>zustand</C> and has a peer dependency on <C>react</C> 18 or newer. Install it directly when you are building custom UI on <C>@elah/core</C> without the full editor SDK:
          </P>
          <CodeBlock language="bash" code={`npm install @elah/react @elah/core`} />
          <P>
            If you use <C>@elah/editor</C> you already have it: the editor re-exports the hooks below, so <C>import {'{ useEditor }'} from &apos;@elah/editor&apos;</C> works. The <C>EditorProvider</C> component itself lives in <C>@elah/editor</C>, not here.
          </P>
        </section>

        {/* EditorContext */}
        <section className="mb-10">
          <H2 id="editor-context">EditorContext</H2>
          <P>
            <C>EditorContext</C> carries one value, <C>EditorContextValue</C>, which is <C>{'{ engine: TimelineEngine; playback: PlaybackEngine }'}</C>. Three hooks read it. All of them throw <C>useEditor must be used inside &lt;EditorProvider&gt;</C> when there is no provider above.
          </P>
          <CodeBlock
            language="tsx"
            code={`import { useEditor, useTimelineEngine, usePlaybackEngine } from '@elah/react'

function Toolbar() {
  const { engine, playback } = useEditor()     // both engines
  const sameEngine = useTimelineEngine()       // engine only: use this for mutations
  const samePlayback = usePlaybackEngine()     // playback only

  return <button onClick={() => engine.undo()}>Undo</button>
}`}
          />
          <P>
            <C>EditorProvider</C> creates both engines, provides the context, and does the wiring that keeps the stores honest: engine <C>change</C> and <C>history:change</C> events sync the tracks and transitions stores, playback state flows both ways between <C>PlaybackEngine</C> and <C>usePlaybackStore</C>, and a <C>project:loaded</C> event with <C>transport: &apos;rewind&apos;</C> returns the playhead to frame 0. If you provide <C>EditorContext</C> yourself, that wiring is yours to write. The stores are module-scoped singletons, so one provider per page.
          </P>
        </section>

        {/* Store hooks */}
        <section className="mb-10">
          <H2 id="store-hooks">Store Hooks</H2>
          <P>
            Each hook is a React view over one of core&apos;s vanilla Zustand stores. Pass a selector so a component re-renders only for the slice it reads. A trim on track 3 never re-renders a component subscribed to track 7.
          </P>
          <div className="mb-4 overflow-hidden border border-outline-variant">
            {STORES.map(([hook, store, desc], i) => (
              <div
                key={hook}
                className={`flex flex-col gap-1 border-b border-outline-variant p-3 last:border-0 sm:flex-row sm:items-start sm:gap-4 ${i % 2 === 0 ? 'bg-surface-low' : 'bg-surface-lowest'}`}
              >
                <div className="sm:w-56 sm:shrink-0">
                  <code className="font-mono text-xs font-medium text-on-surface">{hook}</code>
                  <div className="font-mono text-2xs text-on-surface-variant">{store}</div>
                </div>
                <div className="text-xs leading-relaxed text-on-surface-variant">{desc}</div>
              </div>
            ))}
          </div>
          <CodeBlock
            language="tsx"
            code={`import { useTracksStore, usePlaybackStore, useSelectionStore } from '@elah/react'

const totalFrames = useTracksStore((s) => s.totalFrames)
const isPlaying = usePlaybackStore((s) => s.isPlaying)
const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
const selected = useSelectionStore((s) => s.selectedClipIds) // Set<string>`}
          />
          <P>
            The type of every hook is <C>BoundStoreHook&lt;S&gt;</C>: callable with or without a selector, and it also carries the store&apos;s own API (<C>getState</C>, <C>setState</C>, <C>subscribe</C>).
          </P>
          <P>
            Mutations do not go through the stores. The tracks and transitions stores are read-only mirrors, and writing to them desyncs the UI and breaks undo. Change the project through <C>TimelineEngine</C>. The playback store is the exception for transport: its actions drive <C>PlaybackEngine</C>.
          </P>
          <P>
            <C>useMediaLibrary()</C> returns <C>UseMediaLibraryApi</C>, which is <C>{'{ assets, getAsset, removeAsset, updateAsset, importFiles, importUrl, importBlob }'}</C>. <C>assets</C> is an array in library order. <C>useAssets</C> is an alias for it.
          </P>
        </section>

        {/* Audio hooks */}
        <section className="mb-10">
          <H2 id="audio-hooks">Audio Hooks</H2>
          <P>
            Three hooks work on an <C>AudioPlaybackController</C> from <C>@elah/core</C>. Each accepts <C>null</C> while the controller does not exist yet, and its methods become no-ops until one arrives.
          </P>
          <ul className="mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>
              <C>useAudioMixer(controller)</C> returns <C>{'{ setMasterGain(value), setTrackGain(trackId, value) }'}</C>. Gains are linear, 0 to 2, and ramp click-free. <C>setTrackGain</C> does nothing for a track with no active clips.
            </li>
            <li>
              <C>useMasterVolume(controller, engine)</C> returns <C>{'{ masterVolume, setMasterVolume }'}</C>. Setting it ramps the audio graph immediately and also saves the value to the project model with <C>engine.setMasterVolume</C>, so it survives a remount and is exported.
            </li>
            <li>
              <C>useTrackLevels(controller)</C> returns a <C>{'Map<string, { left: number; right: number }>'}</C> of RMS levels by track id, polled on every animation frame and stopped on unmount. It is empty when the controller is null or no tracks are active. Use it for level meters.
            </li>
          </ul>
          <CodeBlock
            language="tsx"
            code={`import { useMemo, useEffect } from 'react'
import { AudioPlaybackController } from '@elah/core'
import { useEditor, useAudioMixer, useMasterVolume, useTrackLevels } from '@elah/react'

function Mixer() {
  const { engine, playback } = useEditor()

  // <Preview> owns its own controller and does not hand it out. For custom
  // mixer UI, build one and render <Preview enableAudio={false} /> so audio
  // is not played twice.
  const controller = useMemo(
    () => new AudioPlaybackController(playback, () => engine.getProject()),
    [engine, playback],
  )
  useEffect(() => {
    controller.start()
    return () => controller.destroy()
  }, [controller])

  const { setTrackGain } = useAudioMixer(controller)
  const { masterVolume, setMasterVolume } = useMasterVolume(controller, engine)
  const levels = useTrackLevels(controller)   // Map<trackId, { left, right }>

  return null
}`}
          />
        </section>

        {/* Load and presets */}
        <section className="mb-10">
          <H2 id="load-and-presets">Load State &amp; Presets</H2>
          <P>
            Two hooks added in 0.6.0 bind the new vanilla stores.
          </P>
          <P>
            <C>useClipLoadStore</C> reports which clips the preview cannot draw yet. <C>byClipId[clipId]</C> is <C>&apos;loading&apos;</C> (a decoder exists and has not produced a drawable frame) or <C>&apos;error&apos;</C> (the container could not be opened), and a clip that is drawing normally has no entry. This is renderer state. It is never part of the project, undo history or an autosave. The renderer writes it only at clip-boundary events, so subscribers see a handful of notifications per clip and none per frame. The timeline uses it for the loading shimmer.
          </P>
          <CodeBlock
            language="tsx"
            code={`import { useClipLoadStore } from '@elah/react'

function ClipStatus({ clipId }: { clipId: string }) {
  const state = useClipLoadStore((s) => s.byClipId[clipId]) // 'loading' | 'error' | undefined
  if (state === 'loading') return <Spinner />
  if (state === 'error') return <span>Could not open this media</span>
  return null
}`}
          />
          <P>
            <C>useTextStylePresetsStore</C> binds <C>textStylePresetsStore</C>, the user-saved text looks. The built-in ones are the separate <C>BUILT_IN_TEXT_STYLE_PRESETS</C> array. See <Link href="/docs/text-templates-and-motion#style-presets" className="text-on-surface underline decoration-primary underline-offset-4 hover:decoration-2">Text Templates &amp; Motion</Link>.
          </P>
          <CodeBlock
            language="tsx"
            code={`import { useTextStylePresetsStore } from '@elah/react'

const presets = useTextStylePresetsStore((s) => s.presets)
const addPreset = useTextStylePresetsStore((s) => s.addPreset)  // assigns the id`}
          />
        </section>

        {/* Without React */}
        <section className="mb-10">
          <H2 id="without-react">Without React</H2>
          <P>
            Core has zero React imports, enforced by a test, so you can use every store from event handlers, workers, Vue, Svelte or plain scripts. Import the vanilla stores from <C>@elah/core</C> (or <C>@elah/editor</C>) and use the standard Zustand vanilla API.
          </P>
          <CodeBlock
            language="typescript"
            code={`import { tracksStore, playbackStore, selectionStore } from '@elah/core'

// Read now
const { tracks, totalFrames } = tracksStore.getState()
const clips = tracksStore.getState().clips[trackId]

// Subscribe. Returns an unsubscribe function.
const unsubscribe = playbackStore.subscribe((state, prev) => {
  if (state.isPlaying !== prev.isPlaying) onTransportChange(state.isPlaying)
})

// Subscribe to a slice by comparing in the listener
tracksStore.subscribe((state, prev) => {
  if (state.totalFrames !== prev.totalFrames) updateDurationLabel(state.totalFrames)
})

// Playback stays the engine's job
playbackStore.getState().togglePlayPause()`}
          />
          <P>
            The stores are only mirrors. Something has to feed them, and in React that is <C>EditorProvider</C>. Outside React you create the engines yourself and call <C>tracksStore.getState().sync(project, {'{ canUndo, canRedo }'})</C> and <C>transitionsStore.getState().sync(project)</C> from <C>engine.on(&apos;change&apos;, ...)</C>. Or skip the stores entirely and read <C>engine.getProject()</C> and subscribe with <C>engine.on</C>, which is all a headless script needs.
          </P>
          <P>
            For a typed view of the whole data model see <Link href="/docs/api#types" className="text-on-surface underline decoration-primary underline-offset-4 hover:decoration-2">API Reference: Types</Link>. The same <C>TimelineEngine</C> runs unchanged in Node and Web Workers, which is how <Link href="/docs/cli" className="text-on-surface underline decoration-primary underline-offset-4 hover:decoration-2">@elah/cli</Link> renders projects server-side.
          </P>
        </section>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
