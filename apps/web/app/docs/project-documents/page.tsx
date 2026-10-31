import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { DocsToc } from '@/components/docs/DocsToc'
import { Code } from '@/components/docs/Code'
import { C, Callout, DocsPager, H2, H3, P, PropTable } from '@/components/docs/DocsKit'
import { PageHeader } from '@/components/site/PageHeader'
import { label } from '@/components/eb'

export const metadata: Metadata = {
  title: 'Project Documents',
  description:
    'Open a stored project safely: readProjectDocument and ProjectDocumentError, PROJECT_VERSION, relinkProjectMedia, loadProject options and the project:loaded event, and media library snapshots.',
  alternates: { canonical: '/docs/project-documents' },
}

const toc = [
  { id: 'overview', title: 'Opening a saved project', level: 2 },
  { id: 'reading-a-document', title: 'Reading a document', level: 2 },
  { id: 'versioning', title: 'Versioning', level: 2 },
  { id: 'relinking-media', title: 'Relinking media', level: 2 },
  { id: 'load-project', title: 'loadProject & project:loaded', level: 2 },
  { id: 'media-library-snapshots', title: 'Media library snapshots', level: 2 },
  { id: 'browser-persistence', title: 'Browser persistence', level: 2 },
]

const link = 'text-on-surface underline decoration-[#FF003C] underline-offset-4 hover:decoration-2'

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="my-4 list-none space-y-3 p-0 text-[15px] leading-[1.75] text-on-surface/85">
      {items.map((t, i) => (
        <li key={i} className="flex gap-3">
          <span aria-hidden className="mt-[11px] h-[5px] w-[5px] shrink-0 bg-on-surface" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  )
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="my-5 list-none space-y-0 border border-outline-variant p-0">
      {items.map((t, i) => (
        <li key={i} className="flex gap-4 border-b border-outline-variant px-4 py-3 text-[15px] leading-[1.7] text-on-surface/85 last:border-b-0">
          <span className={`mt-[3px] flex h-5 w-5 shrink-0 items-center justify-center border border-on-surface text-[11px] text-on-surface ${label}`}>{i + 1}</span>
          <span>{t}</span>
        </li>
      ))}
    </ol>
  )
}

/** What readProjectDocument repairs versus what it refuses, side by side. */
function RepairOrRefuse() {
  const col = (title: string, note: string, items: string[], warn = false) => (
    <div className="flex flex-col gap-2 bg-surface px-4 py-4">
      <span className={`flex items-center gap-2 ${label} ${warn ? 'text-[#FF003C]' : 'text-on-surface'}`}>
        <span aria-hidden className={`h-[7px] w-[7px] ${warn ? 'bg-[#FF003C]' : 'bg-on-surface'}`} />
        {title}
      </span>
      <span className="text-[13px] text-on-surface-variant">{note}</span>
      <ul className="m-0 mt-1 list-none space-y-1.5 p-0 text-[14px] leading-[1.5] text-on-surface/85">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  )
  return (
    <div className="my-6 grid gap-px border border-outline-variant bg-outline-variant sm:grid-cols-2">
      {col('Repaired', 'Defaulting loses nothing, and the project opens.', [
        'Missing stage → 1080 × 1920',
        'Missing transitions → empty list',
        'Track without a volume → 1',
        'Track with no usable height → 64',
        'Positions and lengths → whole frames',
      ])}
      {col('Refused', 'Opening these as empty would be a lie the first autosave makes permanent.', [
        'Not an object, or no frame rate',
        'tracks is not a list',
        'clips is not keyed by track id',
        'Two tracks with the same id',
        'A track of unknown kind',
        'A clip with an unknown type, no position or no length',
      ], true)}
    </div>
  )
}

export default function ProjectDocumentsPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          eyebrow="Engine &amp; data"
          title="Project Documents"
          lede="Save a project, then open it again safely: check the stored document, load it, and reconnect its media and thumbnails."
        />

        <H2 id="overview">Opening a saved project</H2>
        <P>
          A project that went through <C>JSON.stringify</C> and back is not a <C>Project</C> any more; it is <C>unknown</C>. Opening one takes
          four steps, each covered below:
        </P>
        <Steps
          items={[
            <>
              <C>readProjectDocument</C> checks the stored document and turns it back into a <C>Project</C>, or throws.
            </>,
            <>
              <C>engine.loadProject</C> puts it in the editor.
            </>,
            <>
              <C>hydrateMediaLibrary</C> restores the media library: filmstrips, waveforms, real sizes.
            </>,
            <>
              <C>relinkProjectMedia</C> reconnects clips to their media, and tells you which files are gone.
            </>,
          ]}
        />

        <H2 id="reading-a-document">Reading a document</H2>
        <P>
          <C>readProjectDocument</C> takes whatever you read from storage and returns a complete <C>Project</C>, or throws a{' '}
          <C>ProjectDocumentError</C>. It never returns half a project.
        </P>
        <Code
          highlight={[4, 7]}
          code={`
import { readProjectDocument, ProjectDocumentError } from '@elah/editor'

try {
  const project = readProjectDocument(JSON.parse(stored))
  engine.loadProject(project)
} catch (err) {
  if (err instanceof ProjectDocumentError) showMessage(err.code)
  else throw err // for example, JSON.parse failed
}`}
        />
        <PropTable
          nameLabel="err.code"
          rows={[
            { name: "'unreadable'", desc: 'The document is broken in a way that cannot be repaired.' },
            { name: "'unsupported-version'", desc: <>It was saved by a newer build. <C>err.documentVersion</C> says which version.</> },
          ]}
        />
        <Callout title="Decide what to say from err.code, not the message">
          The code is stable; the message text is not. <C>isReadableProjectDocument(stored)</C> gives the same answer as a boolean, for deciding
          what to show before you try.
        </Callout>

        <H3>What gets repaired, what gets refused</H3>
        <RepairOrRefuse />
        <Bullets
          items={[
            <>
              <strong className="font-semibold text-on-surface">Clips are never dropped.</strong> A clip whose media is missing is still the
              user&apos;s work; see relinking below.
            </>,
            'A transition that no longer makes sense (unknown kind, or a clip gone) is dropped quietly. The clips are untouched, so nothing is lost.',
            'Clips filed under a track that no longer exists are dropped, because they would stretch the timeline with nothing in it.',
          ]}
        />
        <P>
          The one option is <C>defaultTrackHeight</C> (default 64), for tracks whose stored height is missing or nonsense.
        </P>

        <H2 id="versioning">Versioning</H2>
        <P>
          <C>PROJECT_VERSION</C> is the newest version this build can read: currently 5. A saved project is stamped with the{' '}
          <strong className="font-semibold text-on-surface">lowest</strong> version that can hold what it uses, so a project without newer
          features stays readable by older builds.
        </P>
        <PropTable
          nameLabel="Version"
          rows={[
            { name: '1', desc: 'Video, audio, text, image, shape and freehand clips, and the fade, slide and wipe transitions. A document with no version stamp reads as 1.' },
            { name: '2', desc: 'Adds adjustment clips, which apply effects to everything beneath them.' },
            { name: '3', desc: 'Adds generator clips, shape draw-on, and the zoom, spin, whip, glitchCut, warpDissolve and lumaWipe transitions.' },
            { name: '4', desc: 'Adds compound clips: a nested project played as one clip.' },
            { name: '5', desc: 'Adds sequence clips: an animated image or a numbered frame set.' },
          ]}
        />
        <P>
          Keyframes, text animators, effects, audio settings, masks and motion paths are optional fields that an older build ignores, so they do
          not raise the stamp. Every 0.6.x document opens unchanged in 1.0; a 0.6.x build opens only version 1.
        </P>
        <Callout kind="warning" title="A document from a newer build is refused">
          It throws <C>&apos;unsupported-version&apos;</C>. The fields this build does not understand are exactly the ones it would delete on the
          next autosave, so it refuses rather than open and damage it. A version that is not a whole number of at least 1 is{' '}
          <C>&apos;unreadable&apos;</C>.
        </Callout>
        <H3>The simple pair</H3>
        <P>
          <C>serializeProject(engine)</C> and <C>deserializeProject(engine, json)</C> still save and restore in one call each, using{' '}
          <C>readProjectDocument</C> underneath. On bad JSON or an unreadable document, <C>deserializeProject</C> throws and leaves the engine as it
          was.
        </P>

        <H2 id="relinking-media">Relinking media</H2>
        <P>
          A clip stores its <C>src</C> (what plays) and an <C>assetId</C> (where its filmstrip and size come from). The media library gives out
          new ids on every page load, so after a reload the <C>assetId</C> points at nothing. The video still plays, but the clip has no
          thumbnails and its selection box covers the whole stage.
        </P>
        <P>
          <C>relinkProjectMedia</C> fixes that by matching clips to library assets on <C>src</C>:
        </P>
        <Code
          highlight={[4, 7]}
          code={`
import { relinkProjectMedia, missingMediaSummary, mediaLibraryStore } from '@elah/editor'

const assets = Object.values(mediaLibraryStore.getState().assets)
const { project, relinked, missing } = relinkProjectMedia(engine.getProject(), assets)

if (relinked > 0) {
  engine.loadProject(project, { transport: 'keep', history: 'keep' })
}

const names = missingMediaSummary(missing) // null, 'A', 'A and B', or 'A, B and 3 more'
if (names) showToast(\`Re-add the files for: \${names}\`)`}
        />
        <Bullets
          items={[
            <>
              It changes nothing itself, so you choose when to apply it. That matters because the library fills in after the project is already
              on screen. If nothing changed, it returns the same project object.
            </>,
            <>
              <C>missing</C> lists each clip whose file is gone (<C>clipId</C>, <C>clipName</C>, <C>kind</C>). Those clips stay exactly where they
              are, with their name, position and length.
            </>,
            <>
              <C>missingMediaSummary</C> keeps the message short on a project with thirty broken clips: it names up to two and counts the rest.
            </>,
          ]}
        />
        <Callout kind="warning" title="Files imported from the user's device do not survive a reload">
          They play from a <C>blob:</C> (or <C>data:</C>) URL that dies with the page. <C>isRecoverableMediaSrc(src)</C> tells you which sources
          can be fetched again: <C>false</C> for <C>blob:</C> and <C>data:</C>, <C>true</C> for <C>https:</C>. To keep local files, store their
          bytes yourself, as described under browser persistence.
        </Callout>

        <H2 id="load-project">loadProject &amp; project:loaded</H2>
        <P>
          <C>engine.loadProject(project, options)</C> replaces the whole composition. It expects a valid <C>Project</C>, so anything from JSON goes
          through <C>readProjectDocument</C> first; that way a refusal can be shown before the editor&apos;s contents are thrown away.
        </P>
        <PropTable
          nameLabel="Option"
          rows={[
            { name: 'transport', type: "'rewind' | 'keep'", desc: <>Default <C>rewind</C>: stop and go back to frame 0. <C>keep</C> leaves the playhead where it is.</> },
            { name: 'history', type: "'reset' | 'keep'", desc: <>Default <C>reset</C>: the new project is the start of undo history. <C>keep</C> leaves undo, redo and any drag in progress alone.</> },
          ]}
        />
        <P>Opening a document should use the defaults. The engine then emits <C>project:loaded</C>:</P>
        <Code
          code={`
engine.on('project:loaded', ({ project, transport }) => {
  // Fires after 'change' and 'history:change', so the stores are already up to date.
})`}
        />
        <Callout title="EditorProvider rewinds the playhead for you">
          The engine does not know about the <C>PlaybackEngine</C>, so <C>project:loaded</C> carries the <C>transport</C> instruction and{' '}
          <C>EditorProvider</C> acts on it. If you build your own editor shell, do the same.
        </Callout>
        <Callout title="Why relinking uses keep / keep">
          Relinking can land long after the project opened, when the user may have edited it or be mid-drag. Resetting history would throw away
          real undo steps just to repair an internal reference. Undoing past the repair costs a filmstrip, never work.
        </Callout>

        <H2 id="media-library-snapshots">Media library snapshots</H2>
        <P>
          The media library starts empty on every page load. Clips still play from their own <C>src</C>, but the filmstrips, waveforms and real
          sizes are gone, so a restored project shows grey boxes. Snapshot the library when you save and restore it when you open:
        </P>
        <Code
          highlight={[9, 16]}
          code={`
import {
  mediaLibraryStore,
  snapshotMediaLibrary,
  hydrateMediaLibrary,
  refreshMissingThumbnails,
} from '@elah/editor'

// Save
const entries = snapshotMediaLibrary(mediaLibraryStore.getState())
await myStore.put(entries)

// Restore
const referencedSrcs = new Set(
  Object.values(project.clips).flat().flatMap((c) => (c.src ? [c.src] : [])),
)
const { needsThumbnail } = hydrateMediaLibrary(await myStore.get(), { referencedSrcs })
refreshMissingThumbnails(needsThumbnail) // fire and forget`}
        />
        <Bullets
          items={[
            'The snapshot skips assets still loading, because their duration and size are only guesses.',
            <>
              <C>hydrateMediaLibrary</C> keeps the stored ids, so clips&apos; <C>assetId</C> references work again straight away. It never overwrites
              an asset already loaded this session.
            </>,
            <>
              An entry whose file is gone (<C>blob:</C>, <C>data:</C>) is restored only if a clip still uses it, which is what{' '}
              <C>referencedSrcs</C> is for. Its saved filmstrip is all that keeps that clip from being a grey box.
            </>,
            <>
              <C>refreshMissingThumbnails</C> redraws thumbnails that did not come back. It is cosmetic: the project plays either way.{' '}
              <C>relinkProjectMedia</C> still catches anything that matches by <C>src</C> instead of id.
            </>,
          ]}
        />
        <H3>Related helpers</H3>
        <PropTable
          nameLabel="Export"
          rows={[
            {
              name: 'beginImportUrl(url)',
              desc: (
                <>
                  Adds a remote URL as a pending asset right away and finishes loading it in the background. See{' '}
                  <Link href="/docs/clips#growing-clips" className={link}>
                    Growing clips
                  </Link>
                  .
                </>
              ),
            },
            { name: 'probeHasAudio(src)', desc: 'Reads only the file header (with range requests over http) to tell whether a video has sound.' },
            { name: 'determineAssetHasAudio(assetId)', desc: 'Runs that once per asset and saves the answer as hasAudio in the library.' },
            { name: 'hasAudioDetermined(assetId)', desc: <>Whether the header check has answered yet. Exported from <C>@elah/core</C> only, not <C>@elah/editor</C>.</> },
          ]}
        />

        <H2 id="browser-persistence">Browser persistence</H2>
        <Callout kind="warning" title="Storage is yours to build">
          The packages give you the snapshot and relink tools, and deliberately know nothing about IndexedDB or accounts. The saving on elah.dev
          is application code, not part of <C>@elah/*</C>.
        </Callout>
        <P>For reference, here is how the elah.dev playground does it (in the repository under <C>apps/web</C>):</P>
        <PropTable
          nameLabel="File"
          rows={[
            { name: 'lib/local-project.ts', desc: <>Keeps the project in <C>localStorage</C> as the raw <C>Project</C>. A document this build cannot read is copied to a backup key first, never overwritten.</> },
            { name: 'lib/media-file-storage.ts', desc: <>Keeps imported files&apos; bytes in IndexedDB, so a reload can create a new URL for each. This is what makes local files survive at all.</> },
            { name: 'lib/media-library-snapshot.ts', desc: <>Stores the library snapshot in a separate IndexedDB database. Thumbnails are about 40 KB per video, too big for <C>localStorage</C>.</> },
          ]}
        />
        <P>All of it fails softly: in private mode, with blocked storage or a full quota, you lose thumbnails and nothing else.</P>

        <DocsPager href="/docs/project-documents" />
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
