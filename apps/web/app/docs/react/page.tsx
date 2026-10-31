import type { Metadata } from 'next'
import Link from 'next/link'
import { DocsToc } from '@/components/docs/DocsToc'
import { Code } from '@/components/docs/Code'
import { C, Callout, DocsPager, H2, H3, P, PropTable } from '@/components/docs/DocsKit'
import { PageHeader } from '@/components/site/PageHeader'

export const metadata: Metadata = {
  title: '@elah/react',
  description:
    'The React bindings for the Elah engine: EditorProvider, EditorContext, useEditor, the store hooks, the media library and audio mixer hooks, and how to use the same stores without React.',
  alternates: { canonical: '/docs/react' },
}

const toc = [
  { id: 'install', title: 'Install', level: 2 },
  { id: 'editor-context', title: 'EditorProvider & context', level: 2 },
  { id: 'store-hooks', title: 'Store hooks', level: 2 },
  { id: 'audio-hooks', title: 'Audio hooks', level: 2 },
  { id: 'load-and-presets', title: 'Load state & presets', level: 2 },
  { id: 'without-react', title: 'Without React', level: 2 },
]

const link = 'text-on-surface underline decoration-[#FF003C] underline-offset-4 hover:decoration-2'

export default function ReactPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          eyebrow="Build the editor"
          title="@elah/react"
          lede="The React layer over the engine: a provider, hooks that read the editor's state, and hooks for audio. The engine itself has no React in it."
        />

        <H2 id="install">Install</H2>
        <P>Use it on its own when you build your own UI on the engine, without the ready-made editor components:</P>
        <Code lang="bash" code={`npm install @elah/react @elah/core`} />
        <P>
          It needs React 18 or newer. If you already use <C>@elah/editor</C>, you have it: the editor re-exports everything on this page.
        </P>

        <H2 id="editor-context">EditorProvider &amp; context</H2>
        <P>
          <C>EditorProvider</C> creates the <C>TimelineEngine</C> and <C>PlaybackEngine</C> and keeps the stores in sync with them. It lives in{' '}
          <C>@elah/react</C> (and <C>@elah/editor</C> re-exports it). Inside it, three hooks give you the engines:
        </P>
        <Code
          highlight={[4]}
          code={`
import { useEditor, useTimelineEngine, usePlaybackEngine } from '@elah/react'

function Toolbar() {
  const engine = useTimelineEngine() // for edits
  const playback = usePlaybackEngine() // for the clock
  const both = useEditor() // { engine, playback }

  return <button onClick={() => engine.undo()}>Undo</button>
}`}
        />
        <Callout kind="warning" title="One provider per page">
          The stores are shared singletons, so two providers on one page would fight over them. All three hooks throw if there is no provider
          above them.
        </Callout>
        <P>What the provider keeps in sync for you:</P>
        <PropTable
          nameLabel="Wiring"
          rows={[
            { name: 'Engine → tracks & transitions stores', desc: <>On every <C>change</C> and <C>history:change</C>, so hooks see the latest project and undo state.</> },
            { name: 'PlaybackEngine ↔ playback store', desc: 'Both ways: the store’s play, pause and seek drive the clock, and the clock updates the store.' },
            { name: 'project:loaded → rewind', desc: <>When a project is opened with <C>transport: &apos;rewind&apos;</C>, the playhead goes back to frame 0.</> },
          ]}
        />
        <P>
          If you provide <C>EditorContext</C> yourself instead, that wiring is yours to write.
        </P>

        <H2 id="store-hooks">Store hooks</H2>
        <P>
          Each hook reads one of the engine&apos;s stores. Pass a selector so a component re-renders only when its part changes: a trim on
          track 3 never re-renders a component that reads track 7.
        </P>
        <Code
          code={`
import { useTracksStore, usePlaybackStore, useSelectionStore } from '@elah/react'

const totalFrames = useTracksStore((s) => s.totalFrames)
const isPlaying = usePlaybackStore((s) => s.isPlaying)
const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
const selected = useSelectionStore((s) => s.selectedClipIds) // a Set`}
        />
        <PropTable
          nameLabel="Hook"
          rows={[
            { name: 'useTracksStore', type: 'tracksStore', desc: 'tracks, clips, stage, totalFrames, canUndo, canRedo. Read-only.' },
            { name: 'useTransitionsStore', type: 'transitionsStore', desc: 'transitions. Read-only.' },
            { name: 'usePlaybackStore', type: 'playbackStore', desc: 'currentFrame, isPlaying, playbackRate, loop, volume, muted, zoom, snapEnabled, and the play, pause and seek actions.' },
            { name: 'useSelectionStore', type: 'selectionStore', desc: 'selectedClipIds and activeTrackId, with selectClip, toggleClipSelection, selectClips, clearSelection and setActiveTrack.' },
            { name: 'useMediaLibraryStore', type: 'mediaLibraryStore', desc: 'assets by id and their order, with addAsset, removeAsset, updateAsset and getAsset.' },
            { name: 'useClipLoadStore', type: 'clipLoadStore', desc: 'Which clips the preview cannot draw yet. See below.' },
            { name: 'useTextStylePresetsStore', type: 'textStylePresetsStore', desc: 'The user’s saved text styles, with addPreset and removePreset.' },
          ]}
        />
        <Callout kind="warning" title="Don't edit the project through the stores">
          The tracks and transitions stores are copies of the engine&apos;s state. Writing to them puts the UI out of sync and breaks undo. Make
          every change through <C>TimelineEngine</C>. The playback store&apos;s actions are the exception: they drive the clock on purpose.
        </Callout>
        <P>
          Every hook can be called with or without a selector, and also has the store&apos;s own <C>getState</C>, <C>setState</C> and{' '}
          <C>subscribe</C> (its type is <C>BoundStoreHook</C>).
        </P>

        <H3>Media library</H3>
        <P>
          <C>useMediaLibrary()</C> (also called <C>useAssets</C>) is the friendlier way in:
        </P>
        <PropTable
          nameLabel="Returns"
          rows={[
            { name: 'assets', type: 'MediaAsset[]', desc: 'Every asset, in the order it was added.' },
            { name: 'importFiles(files)', desc: 'Add files from an input or a drop. Resolves with what was imported and what was skipped.' },
            { name: 'importUrl(url) · importBlob(blob)', desc: 'Add media from a URL or a Blob.' },
            { name: 'getAsset · updateAsset · removeAsset', desc: 'Read, change or delete one asset by id.' },
          ]}
        />

        <H2 id="audio-hooks">Audio hooks</H2>
        <P>
          These work on an <C>AudioPlaybackController</C> from <C>@elah/core</C>. <C>Preview</C> keeps its own controller private, so for a
          custom mixer you create one and turn off <C>Preview</C>&apos;s audio, so nothing plays twice:
        </P>
        <Code
          highlight={[8, 16, 17, 18]}
          code={`
import { useMemo, useEffect } from 'react'
import { AudioPlaybackController } from '@elah/core'
import { useEditor, useAudioMixer, useMasterVolume, useTrackLevels } from '@elah/react'

function Mixer() {
  const { engine, playback } = useEditor()
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
  const levels = useTrackLevels(controller) // Map<trackId, { left, right }>

  return null // your mixer UI
}

// elsewhere: <Preview demuxerFactory={demuxerFactory} enableAudio={false} />`}
        />
        <PropTable
          nameLabel="Hook"
          rows={[
            { name: 'useAudioMixer(controller)', desc: <><C>setMasterGain(v)</C> and <C>setTrackGain(trackId, v)</C>. Linear, 0 to 2, with no clicks. A track with no clips playing ignores it.</> },
            { name: 'useMasterVolume(controller, engine)', desc: <><C>masterVolume</C> and <C>setMasterVolume</C>. Also saves the value to the project, so it survives a remount and ends up in the export.</> },
            { name: 'useTrackLevels(controller)', desc: 'Left and right levels for every playing track, updated every frame. For level meters.' },
          ]}
        />
        <P>
          Each accepts <C>null</C> while the controller is not ready; until then its functions do nothing and levels are empty.
        </P>

        <H2 id="load-and-presets">Load state &amp; presets</H2>
        <P>
          <C>useClipLoadStore</C> tells you which clips the preview cannot draw yet: <C>&apos;loading&apos;</C> while the file opens,{' '}
          <C>&apos;error&apos;</C> if it could not be opened, and no entry when the clip draws normally.
        </P>
        <Code
          highlight={[4]}
          code={`
import { useClipLoadStore } from '@elah/react'

function ClipStatus({ clipId }: { clipId: string }) {
  const state = useClipLoadStore((s) => s.byClipId[clipId])
  if (state === 'loading') return <Spinner />
  if (state === 'error') return <span>Could not open this media</span>
  return null
}`}
        />
        <Callout title="Cheap to subscribe to">
          It only changes when a clip starts or finishes loading, never per frame. It is not part of the project, undo history or autosave. The
          timeline uses it for its loading shimmer.
        </Callout>
        <P>
          <C>useTextStylePresetsStore</C> reads the user&apos;s saved text styles. The built-in ones are the separate{' '}
          <C>BUILT_IN_TEXT_STYLE_PRESETS</C> list; see{' '}
          <Link href="/docs/text-templates-and-motion#style-presets" className={link}>
            Style presets
          </Link>
          .
        </P>
        <Code
          code={`
const presets = useTextStylePresetsStore((s) => s.presets)
const addPreset = useTextStylePresetsStore((s) => s.addPreset) // assigns the id`}
        />

        <H2 id="without-react">Without React</H2>
        <P>
          The engine has no React in it (a test enforces that), so the same stores work in event handlers, workers, Vue, Svelte or plain scripts.
          Import them from <C>@elah/core</C> and use Zustand&apos;s plain API:
        </P>
        <Code
          code={`
import { tracksStore, playbackStore } from '@elah/core'

const { tracks, totalFrames } = tracksStore.getState()

const unsubscribe = playbackStore.subscribe((state, prev) => {
  if (state.isPlaying !== prev.isPlaying) onTransportChange(state.isPlaying)
})

playbackStore.getState().togglePlayPause()`}
        />
        <Callout title="Something has to fill the stores">
          In React, <C>EditorProvider</C> does. Without it, create the engines yourself and, on <C>engine.on(&apos;change&apos;, …)</C>, call{' '}
          <C>tracksStore.getState().sync(project, {'{ canUndo, canRedo }'})</C> and <C>transitionsStore.getState().sync(project)</C>. A headless
          script can skip the stores and use <C>engine.getProject()</C> and <C>engine.on</C> directly.
        </Callout>
        <P>
          The same <C>TimelineEngine</C> runs in Node and Web Workers, which is how{' '}
          <Link href="/docs/cli" className={link}>
            @elah/cli
          </Link>{' '}
          renders on a server. For the full data model, see{' '}
          <Link href="/docs/api#types" className={link}>
            API Reference: Types
          </Link>
          .
        </P>

        <DocsPager href="/docs/react" />
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
