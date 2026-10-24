import type { Metadata } from 'next'
import Link from 'next/link'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'
import { PageHeader } from '@/components/site/PageHeader'

export const metadata: Metadata = {
  title: 'Project Documents',
  description:
    'Open a stored project safely: readProjectDocument and ProjectDocumentError, PROJECT_VERSION, relinkProjectMedia, loadProject options and the project:loaded event, and media library snapshots.',
  alternates: { canonical: '/docs/project-documents' },
}

const toc = [
  { id: 'reading-a-document', title: 'Reading a Document', level: 2 },
  { id: 'versioning', title: 'Versioning', level: 2 },
  { id: 'relinking-media', title: 'Relinking Media', level: 2 },
  { id: 'load-project', title: 'loadProject & project:loaded', level: 2 },
  { id: 'media-library-snapshots', title: 'Media Library Snapshots', level: 2 },
  { id: 'browser-persistence', title: 'Browser Persistence', level: 2 },
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
  return <code className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono">{children}</code>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-sm leading-relaxed text-on-surface-variant">{children}</p>
}

export default function ProjectDocumentsPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        <PageHeader
          variant="doc"
          eyebrow="Engine &amp; data"
          title="Project Documents"
          lede={
            <>
              A project that has been through <C>JSON.stringify</C> and back is not a <C>Project</C>. It is <C>unknown</C>. 0.6.0 adds the primitives for turning a stored document back into one safely, re-attaching its media, and carrying the media library across a page load.
            </>
          }
        />

        {/* Reading */}
        <section className="mb-10">
          <H2 id="reading-a-document">Reading a Document</H2>
          <P>
            <C>readProjectDocument(document, options?)</C> takes anything you read back from storage and returns a <C>Project</C> every consumer can dereference, or throws <C>ProjectDocumentError</C>. It is total: it never returns half a project. The only option is <C>defaultTrackHeight</C> (default 64), used for a track whose stored height is missing or nonsense.
          </P>
          <CodeBlock
            language="typescript"
            code={`import {
  readProjectDocument,
  isReadableProjectDocument,
  ProjectDocumentError,
} from '@elah/editor'

try {
  const project = readProjectDocument(JSON.parse(stored))
  engine.loadProject(project)
} catch (err) {
  if (err instanceof ProjectDocumentError) {
    // err.code is 'unreadable' | 'unsupported-version'
    // err.documentVersion is the stamped version when it had a readable one
    showMessage(err.code)   // decide what to say from the code, not message text
  } else {
    throw err               // e.g. JSON.parse failed
  }
}

// Boolean form, for deciding what to show. Restore with readProjectDocument itself.
isReadableProjectDocument(stored)`}
          />
          <P>
            The split of responsibility is deliberate. <strong className="text-on-surface font-medium">Missing things are repaired</strong>, because defaulting them loses nothing and opens the project. A missing <C>stage</C> becomes 1080 by 1920, missing <C>transitions</C> become an empty list, a track without a volume gets 1, and positions and lengths are rounded to integer frames. <strong className="text-on-surface font-medium">Wrong things are refused</strong>, because opening them as empty would be a lie that the first autosave makes permanent. That covers a document that is not an object, has no frame rate, whose <C>tracks</C> is not a list, whose <C>clips</C> is not indexed by track id, that has two tracks with the same id, a track of unknown kind, or a clip with an unknown type, no position or no length.
          </P>
          <ul className="mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>
              <strong className="text-on-surface font-medium">Clips are never dropped.</strong> A clip whose media has gone missing is still the user&apos;s work. See relinking below.
            </li>
            <li>
              A transition is dropped, not refused, when it no longer makes sense (an unknown kind, or either clip gone). Nothing of the user&apos;s is lost, because the clips themselves are untouched.
            </li>
            <li>
              Clip buckets keyed by a track that no longer exists are dropped, because they would stretch the timeline to a length with nothing in it.
            </li>
          </ul>
        </section>

        {/* Versioning */}
        <section className="mb-10">
          <H2 id="versioning">Versioning</H2>
          <P>
            <C>PROJECT_VERSION</C> is the newest schema version this build reads, currently 5. A saved project is stamped with the <strong className="text-on-surface font-medium">lowest</strong> version that can hold what it uses, so a project without the newer features stays readable by older builds. It is a promise to every build that reads the document, not the version of your app. The project&apos;s own <C>version</C> field carries the stamp.
          </P>
          <div className="mb-4 overflow-hidden rounded-md border border-outline-variant">
            {[
              ['1', 'The 0.6.x model: video, audio, text, image, shape and freehand clips, and the fade, slide and wipe transitions. A document with no version stamp reads as 1.'],
              ['2', 'Adjustment clips (effects applied to everything beneath them).'],
              ['3', 'Generator clips, shape draw-on, and the six newer transitions (zoom, spin, whip, glitchCut, warpDissolve, lumaWipe).'],
              ['4', 'Compound clips (a nested project played as one clip).'],
              ['5', 'Sequence clips (an animated image or a numbered frame set).'],
            ].map(([v, desc], i) => (
              <div
                key={v}
                className={`flex flex-col gap-1 border-b border-outline-variant p-3 last:border-0 sm:flex-row sm:items-start sm:gap-4 ${i % 2 === 0 ? 'bg-surface-low' : 'bg-surface-lowest'}`}
              >
                <code className="font-mono text-xs font-medium text-on-surface sm:w-20 sm:shrink-0">version {v}</code>
                <div className="text-xs leading-relaxed text-on-surface-variant">{desc}</div>
              </div>
            ))}
          </div>
          <P>
            Everything else added since 0.6.x (keyframes, text animators, effects on a clip, audio settings, masks, motion paths) is an optional field that an older build ignores, so it does not raise the stamp. The stamp rises only when a document holds a clip type or transition kind an older build would refuse. A 0.6.x build opens version 1 only; a version 2 to 5 document throws <C>ProjectDocumentError</C> there. Every 0.6.x document opens unchanged in 1.0.0.
          </P>
          <ul className="mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>
              A document with <strong className="text-on-surface font-medium">no <C>version</C></strong> predates the stamp and is read as version 1. Refusing it would strand the earliest saved projects.
            </li>
            <li>
              A document <strong className="text-on-surface font-medium">from a newer build</strong> throws <C>ProjectDocumentError</C> with <C>code: &apos;unsupported-version&apos;</C>. The fields this build does not know about are exactly the ones it would drop on the next autosave, so it refuses instead.
            </li>
            <li>
              A version that is not a whole number of at least 1 is <C>&apos;unreadable&apos;</C>.
            </li>
          </ul>
          <P>
            <C>serializeProject(engine)</C> and <C>deserializeProject(engine, json)</C> are still the simple save and restore pair. They are now a facade over <C>readProjectDocument</C>. <C>deserializeProject</C> throws <C>Not valid project JSON: ...</C> for bad JSON and <C>ProjectDocumentError</C> for an unreadable or too-new document, and leaves the engine untouched in either case. The one behavioural difference from before is the unversioned-document rule above.
          </P>
        </section>

        {/* Relinking */}
        <section className="mb-10">
          <H2 id="relinking-media">Relinking Media</H2>
          <P>
            A clip carries both a <C>src</C> (what the renderer plays) and an <C>assetId</C> (what the timeline reads its filmstrip and intrinsic size from). Only <C>src</C> survives a save. The media library is rebuilt on every page load and hands out fresh ids, so a restored clip&apos;s <C>assetId</C> names an asset that no longer exists. The composition still plays, because the resolver reads <C>src</C>, but the clip has no filmstrip and its selection box falls back to the whole stage.
          </P>
          <P>
            <C>relinkProjectMedia(project, assets)</C> repairs that by matching on <C>src</C> against whatever the library holds. It is pure, so you decide when to apply it, which matters because the library fills asynchronously after the composition is already on screen.
          </P>
          <CodeBlock
            language="typescript"
            code={`import {
  relinkProjectMedia,
  missingMediaSummary,
  isRecoverableMediaSrc,
  mediaLibraryStore,
} from '@elah/editor'

const assets = Object.values(mediaLibraryStore.getState().assets)
const { project, relinked, missing } = relinkProjectMedia(engine.getProject(), assets)

// project is the SAME object reference as the input when nothing changed.
if (relinked > 0) {
  engine.loadProject(project, { transport: 'keep', history: 'keep' })
}

// missing: { clipId, clipName, kind: 'video' | 'audio' | 'image' }[]
const names = missingMediaSummary(missing) // null | 'A' | 'A and B' | 'A, B and 3 more'
if (names) showToast(\`Re-add the files for: \${names}\`)

isRecoverableMediaSrc('blob:https://example.com/abc') // false
isRecoverableMediaSrc('https://cdn.example.com/a.mp4') // true`}
          />
          <ul className="mt-4 mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>
              A <C>blob:</C> or <C>data:</C> source cannot be fetched again in a later session. It was minted by <C>URL.createObjectURL</C> when the user imported a file from their device and dies with the page that created it. <C>isRecoverableMediaSrc(src)</C> names that case.
            </li>
            <li>
              Clips whose source cannot be recovered are reported in <C>missing</C> and left exactly where they are, with name, position and length intact. They are never dropped, because that is the one outcome the user can neither see nor undo.
            </li>
            <li>
              <C>missingMediaSummary</C> encodes the rule that keeps the message readable on a project with thirty broken clips: name up to two, count the rest. It returns <C>null</C> for an empty list.
            </li>
          </ul>
        </section>

        {/* loadProject */}
        <section className="mb-10">
          <H2 id="load-project">loadProject &amp; project:loaded</H2>
          <P>
            <C>engine.loadProject(project, options?)</C> replaces the whole composition. It takes a valid <C>Project</C>, so anything that arrived as JSON goes through <C>readProjectDocument</C> first. That is where an unreadable or too-new document is refused, and it is separate so the refusal can be shown before the editor&apos;s contents are thrown away.
          </P>
          <CodeBlock
            language="typescript"
            code={`type LoadProjectTransport = 'rewind' | 'keep'
type LoadProjectHistory = 'reset' | 'keep'

engine.loadProject(project, {
  transport: 'rewind', // default. 'keep' leaves the playhead where it is
  history: 'reset',    // default. 'keep' leaves undo/redo and any open drag intact
})

// Emitted after 'change' and 'history:change', so stores are already synced.
engine.on('project:loaded', ({ project, transport }) => {
  // ProjectLoadedEvent = { project: Project; transport: LoadProjectTransport }
})`}
          />
          <P>
            Opening or reloading a document uses the defaults. The playhead belonged to a composition that is gone, so it should stop and return to frame 0, and the document that just arrived is the history&apos;s starting point, so ctrl+Z must not walk back into the empty timeline that existed before it. <C>PlaybackEngine</C> is a separate object that the engine deliberately does not know about, which is why <C>project:loaded</C> carries the <C>transport</C> instruction. <C>EditorProvider</C> subscribes to it and does the rewind for you. If you build your own composition layer, do the same.
          </P>
          <div className="rounded-md border border-outline-variant bg-surface-low p-4">
            <div className="label-mono mb-1 text-2xs text-on-surface-variant opacity-90">Why the relink pass uses history: &apos;keep&apos;</div>
            <p className="text-xs leading-relaxed text-on-surface-variant">
              The relink pass does not bring a new composition. It hands back the one already on screen with internal library references repaired, and it lands whenever the project&apos;s assets finish importing, which can be long after the open. By then the user may have trimmed a clip, added a title, or be mid-drag. Resetting history would throw away real undo steps to swap an internal reference, and an open drag still has a <C>commitInteraction()</C> coming. So pass <C>{"{ transport: 'keep', history: 'keep' }"}</C>: the playhead does not jump, and the undo stacks, the interaction snapshot and any open batch survive. Entries already on the stacks still hold the pre-repair references. Undoing past the repair costs a filmstrip, not work, and those ids are session-scoped anyway.
            </p>
          </div>
        </section>

        {/* Snapshots */}
        <section className="mb-10">
          <H2 id="media-library-snapshots">Media Library Snapshots</H2>
          <P>
            The media library is module-scoped and starts empty on every load. A clip plays from its own <C>src</C> and never asks the library for anything, so what does not survive is everything only the library held: the filmstrip, the waveform, the real duration and dimensions. A restored composition comes back with grey boxes where the thumbnails were. Two functions carry the library across, and storing the result is up to you.
          </P>
          <CodeBlock
            language="typescript"
            code={`import {
  mediaLibraryStore,
  snapshotMediaLibrary,
  hydrateMediaLibrary,
  refreshMissingThumbnails,
} from '@elah/editor'

// Save: something storable. Assets still being probed (status 'pending') are skipped,
// because their duration and size are provisional guesses.
const entries = snapshotMediaLibrary(mediaLibraryStore.getState())
await myStore.put(entries)

// Restore: keeps the stored ids, so restored clips' assetId references resolve directly.
const referencedSrcs = new Set(
  Object.values(project.clips).flat().flatMap((c) => (c.src ? [c.src] : [])),
)
const { hydrated, needsThumbnail } = hydrateMediaLibrary(await myStore.get(), {
  referencedSrcs,
})

// Fire-and-forget: decode thumbnails for entries that came back without them.
refreshMissingThumbnails(needsThumbnail)`}
          />
          <ul className="mt-4 mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>
              <C>hydrateMediaLibrary</C> never overwrites. An asset already registered under the same id or the same <C>src</C> came from this session and is fresher than anything stored.
            </li>
            <li>
              An entry whose source is dead (<C>blob:</C> or <C>data:</C>) is restored only when a clip still points at it, which is what <C>referencedSrcs</C> is for. Its stored filmstrip is the one thing that keeps that clip from being an anonymous grey rectangle.
            </li>
            <li>
              <C>needsThumbnail</C> lists hydrated ids that came back without thumbnails and whose source can still be fetched. <C>refreshMissingThumbnails(ids, schedule?)</C> asks for a decode of each. It is cosmetic: the composition plays whether or not they land. <C>scheduleThumbnailById(assetId)</C> is the single-asset call it uses.
            </li>
            <li>
              <C>relinkProjectMedia</C> stays the fallback for anything that comes back by <C>src</C> rather than by id, such as a re-import or a snapshot that predates the clip.
            </li>
          </ul>
          <P>
            Related media-library helpers added in 0.6.0, covered with the clip workflow on the <Link href="/docs/clips#growing-clips" className="text-primary hover:underline">Clips page</Link>: <C>beginImportUrl(url, opts?)</C> registers a remote URL as a <C>status: &apos;pending&apos;</C> asset immediately and resolves it later. <C>probeHasAudio(src)</C> reads the container header (range requests for http sources, so not the media payload) and answers whether a video carries an audio track. <C>determineAssetHasAudio(assetId)</C> memoizes that per asset and writes <C>hasAudio</C> back to the library, and <C>hasAudioDetermined(assetId)</C> says whether the container probe has already answered, so weaker signals do not overwrite it (it is exported from <C>@elah/core</C> but not re-exported by the <C>@elah/editor</C> barrel). <C>beginImportUrl</C> starts the determination itself for video, so a caller that imports and inserts in one click gets a real answer rather than the placeholder.
          </P>
        </section>

        {/* Browser persistence */}
        <section className="mb-10">
          <H2 id="browser-persistence">Browser Persistence</H2>
          <div className="mb-4 rounded-md border border-outline-variant bg-surface-low p-4">
            <div className="label-mono mb-1 text-2xs text-on-surface-variant opacity-90">Not part of the packages</div>
            <p className="text-xs leading-relaxed text-on-surface-variant">
              The IndexedDB persistence on elah.dev itself is <strong className="text-on-surface font-medium">application code</strong>, not part of <C>@elah/*</C>. The packages give you the snapshot and relink primitives above. They deliberately know nothing about IndexedDB, tenants or projects. You build the storage adapter.
            </p>
          </div>
          <P>
            For reference, the playground here wires them together in the web app (see the repository under <C>apps/web</C>):
          </P>
          <ul className="mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>
              <C>lib/local-project.ts</C> keeps the composition in <C>localStorage</C>. The document is the raw <C>Project</C>, because it already carries <C>version</C> and <C>readProjectDocument</C> already owns versioning, repair and refusal. A document this build cannot read is copied to a backup key before the editor carries on, never written over.
            </li>
            <li>
              <C>lib/media-file-storage.ts</C> keeps imported files&apos; bytes in IndexedDB, so a refresh can mint a fresh object URL for each. This is what makes a locally imported file recoverable at all, since the original <C>blob:</C> URL is dead.
            </li>
            <li>
              <C>lib/media-library-snapshot.ts</C> stores the output of <C>snapshotMediaLibrary</C> in a separate IndexedDB database. It is IndexedDB rather than <C>localStorage</C> because thumbnails are base64 strings of roughly 40 KB per video asset, and a library of any size would push the origin toward its storage budget and risk losing the timeline to save its thumbnails.
            </li>
          </ul>
          <P>
            All of it fails soft: private mode, blocked storage or a full quota loses filmstrips and nothing else.
          </P>
        </section>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
