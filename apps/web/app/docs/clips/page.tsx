import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { DocsToc } from '@/components/docs/DocsToc'
import { Code } from '@/components/docs/Code'
import { C, Callout, DocsPager, H2, H3, P, PropTable } from '@/components/docs/DocsKit'
import { PageHeader } from '@/components/site/PageHeader'
import { label } from '@/components/eb'

export const metadata: Metadata = {
  title: 'Clips & Tracks',
  description:
    'Multiple video tracks, clip speed, crop, corner radius, protected and pinned tracks, and growing a clip once its remote media has been probed.',
  alternates: { canonical: '/docs/clips' },
}

const toc = [
  { id: 'multiple-video-tracks', title: 'Multiple video tracks', level: 2 },
  { id: 'speed', title: 'Speed', level: 2 },
  { id: 'crop', title: 'Crop', level: 2 },
  { id: 'corner-radius', title: 'Corner radius', level: 2 },
  { id: 'protected-and-pinned-tracks', title: 'Protected & pinned tracks', level: 2 },
  { id: 'growing-clips', title: 'Growing clips', level: 2 },
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

/** cornerRadius drawn to scale: a fraction of the shorter side of the box. */
function RadiusSwatch({ value, w, h }: { value: number; w: number; h: number }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="bg-on-surface" style={{ width: w, height: h, borderRadius: value * Math.min(w, h) }} />
      <span className={`text-on-surface-variant ${label}`}>{value}</span>
    </div>
  )
}

export default function ClipsPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 max-w-3xl flex-1">
        <PageHeader
          variant="doc"
          eyebrow="Engine &amp; data"
          title="Clips &amp; Tracks"
          lede="Layer several video tracks, change a clip's speed, crop it, round its corners, fix a track layout, and grow a clip once its real length is known."
        />

        <H2 id="multiple-video-tracks">Multiple video tracks</H2>
        <P>
          A project can have several video tracks. Each <C>addTrack(&apos;video&apos;)</C> adds a new lane, and clips that overlap on different
          lanes layer instead of conflicting.
        </P>
        <Bullets
          items={[
            <>
              <strong className="font-semibold text-on-surface">The top lane draws on top.</strong> A lower <C>track.order</C> is higher on the
              timeline and higher in the picture.
            </>,
            <>
              <strong className="font-semibold text-on-surface">New video tracks go below the last video track</strong>, so video lanes stay
              grouped above audio and elements. Other kinds of track are added at the bottom.
            </>,
          ]}
        />
        <Code
          highlight={[7]}
          code={`
const base = engine.addTrack('video', { name: 'Base' })
const pip = engine.addTrack('video', { name: 'Picture in picture' })
// pip lands below base, so base draws on top of it.

// Put pip on top: pass every track id, topmost first.
const rest = engine.getProject().tracks.map((t) => t.id).filter((id) => id !== pip.id)
engine.reorderTracks([pip.id, ...rest])`}
        />
        <Callout kind="warning" title="reorderTracks needs the complete list">
          Pass every track id, topmost first. A track you leave out keeps its old <C>order</C> value and ends up in the wrong place.
        </Callout>
        <P>
          You can also start with several video lanes by listing them in <C>initialTracks</C>.
        </P>
        <Callout title="The CLI build spec still uses one video track">
          The headless build spec in{' '}
          <Link href="/docs/cli#build-spec" className={link}>
            the CLI docs
          </Link>{' '}
          places every video clip on a single video track, even though the engine supports more.
        </Callout>

        <H2 id="speed">Speed</H2>
        <P>
          <C>speed</C> makes a video clip play faster or slower: 2 is double speed, 0.5 is half. It works on video clips only, ranges from 0.25
          to 4, and defaults to 1.
        </P>
        <Code
          highlight={[2, 5]}
          code={`
// The clip is 150 frames long at normal speed.
engine.setClipSpeed(clip.id, trackId, 2)
// Now 75 frames: the same footage, played twice as fast.

engine.setClipSpeed(clip.id, trackId, 0.5)
// Slower and longer, but it never grows into the next clip.`}
        />
        <Callout title="Use setClipSpeed, not updateClip">
          <C>setClipSpeed</C> also updates the clip&apos;s length on the timeline (<C>durationFrames</C>). Writing <C>speed</C> on its own leaves
          the length wrong.
        </Callout>
        <Bullets
          items={[
            <>
              The trim (<C>sourceStartFrame</C>, <C>sourceDurationFrames</C>) does not change. Only the rate it plays at does.
            </>,
            'Speeding up shrinks the clip in place. Slowing down grows it, but only up to the next clip on the track. Nothing else on the timeline moves.',
            'Nothing happens on a locked track or on a clip that is not video.',
            'Transitions that no longer fit after the length change are removed, in the same undo step.',
            <>
              Preview and export use the same mapping, <C>floor(localFrame * speed) + sourceStartFrame</C>, so they always agree.
            </>,
          ]}
        />

        <H2 id="crop">Crop</H2>
        <P>
          <C>crop</C> picks the part of the source to show. It is a rectangle in fractions (0 to 1) of the media&apos;s full size, measured from
          the top left. Leave it out to show the whole frame. It works on video and image clips.
        </P>
        <Code
          highlight={[4, 5]}
          code={`
import { type CropRect } from '@elah/editor'

// Keep the middle half, left to right.
const crop: CropRect = { x: 0.25, y: 0, width: 0.5, height: 1 }
engine.updateClip(clip.id, trackId, { crop })`}
        />
        <P>
          Cropping changes what is visible, not the clip&apos;s scale: the clip&apos;s box on the stage gets smaller and <C>transform.scale</C>{' '}
          stays as you set it. Users can crop by hand in the preview; see{' '}
          <Link href="/docs/editor#transforms" className={link}>
            Editor: Transforms
          </Link>
          .
        </P>
        <H3>Helpers</H3>
        <PropTable
          nameLabel="Export"
          rows={[
            { name: 'normalizeCrop(crop)', desc: <>Moves a crop back inside the frame and keeps each side at least 0.05. <C>normalizeCrop(undefined)</C> returns <C>FULL_CROP</C>.</> },
            { name: 'FULL_CROP', desc: 'The whole frame: x 0, y 0, width 1, height 1.' },
            { name: 'transformFromContainRect(cw, ch, sw, sh)', desc: 'The transform that matches the default fitted placement, for content size cw × ch on a stage sw × sh. Set it before the first drag so a clip without a transform does not jump.' },
            { name: 'transformFromCoverRect(cw, ch, sw, sh)', desc: 'Same arguments, but fills the stage instead of fitting inside it.' },
          ]}
        />
        <Code
          code={`
normalizeCrop({ x: 0.9, y: 0, width: 0.5, height: 1 })
// → { x: 0.5, y: 0, width: 0.5, height: 1 }`}
        />

        <H2 id="corner-radius">Corner radius</H2>
        <P>
          <C>cornerRadius</C> rounds the corners of a video or image clip. It is a fraction, from 0 to 0.5, of the clip&apos;s shorter side.
        </P>
        <div className="my-6 flex flex-wrap items-end gap-8 border border-outline-variant px-6 py-6">
          <RadiusSwatch value={0} w={128} h={72} />
          <RadiusSwatch value={0.12} w={128} h={72} />
          <RadiusSwatch value={0.5} w={128} h={72} />
          <RadiusSwatch value={0.5} w={72} h={72} />
        </div>
        <P>0 (or leaving it out) is square. 0.5 gives a full ellipse, which is a circle when the clip is square.</P>
        <Code code={`engine.updateClip(clip.id, trackId, { cornerRadius: 0.12 })`} />

        <H2 id="protected-and-pinned-tracks">Protected &amp; pinned tracks</H2>
        <P>Two optional track settings give you a fixed layout, such as a music lane that is always there and always at the bottom.</P>
        <PropTable
          rows={[
            { name: 'protected', type: 'boolean', optional: true, desc: <>The track cannot be removed. <C>engine.removeTrack</C> does nothing for it.</> },
            { name: 'pinned', type: "'bottom'", optional: true, desc: 'The track stays below every unpinned track. New non-video tracks are added just above the pinned ones, not after them.' },
          ]}
        />
        <Code
          highlight={[5, 11]}
          code={`
import { EditorProvider, type InitialTrackConfig } from '@elah/editor'

const tracks: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video' },
  { kind: 'audio', name: 'Audio', protected: true, pinned: 'bottom' },
]

<EditorProvider fps={30} initialTracks={tracks}>{/* ... */}</EditorProvider>

// Or later:
engine.addTrack('audio', { name: 'Music', pinned: 'bottom' })`}
        />
        <P>
          Both work in <C>addTrack</C> options and in <C>InitialTrackConfig</C>, and both are kept when a project is saved and read back with{' '}
          <C>readProjectDocument</C>.
        </P>

        <H2 id="growing-clips">Growing clips</H2>
        <P>
          You can put a remote video on the timeline before you know how long it is, and fix its length once it has loaded:
        </P>
        <ol className="my-4 list-none space-y-3 p-0 text-[15px] leading-[1.75] text-on-surface/85">
          {[
            <>
              <C>beginImportUrl(url)</C> adds the URL to the media library straight away as a <C>pending</C> asset, with a 5-second placeholder
              length, and loads it in the background.
            </>,
            <>Insert a clip right away, at the placeholder length.</>,
            <>
              When the asset is <C>ready</C>, call <C>growClipToAssetDuration</C> to give the clip its real length.
            </>,
          ].map((t, i) => (
            <li key={i} className="flex gap-3">
              <span className={`mt-[3px] flex h-5 w-5 shrink-0 items-center justify-center border border-on-surface text-[11px] text-on-surface ${label}`}>
                {i + 1}
              </span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
        <Code
          highlight={[8, 19]}
          code={`
import {
  beginImportUrl,
  mediaLibraryStore,
  insertMediaAsset,
  growClipToAssetDuration,
} from '@elah/editor'

const asset = await beginImportUrl(url)
const result = await insertMediaAsset(engine, asset.id, { videoOnly: true })
if (!result.ok) return

const clipId = result.clipIds[0]
const fallbackFrames = engine.findClip(clipId)!.clip.durationFrames

const unsubscribe = mediaLibraryStore.subscribe((state) => {
  const ready = state.assets[asset.id]
  if (ready?.status !== 'ready') return
  unsubscribe()
  growClipToAssetDuration(engine, clipId, fallbackFrames, ready.durationSec)
})`}
        />
        <Callout title="Read the inserted length, not the placeholder">
          The clip can be shorter than 5 seconds if the gap on the track was small. That is why the example reads <C>durationFrames</C> back from
          the engine.
        </Callout>
        <PropTable
          nameLabel="Argument"
          rows={[
            { name: 'engine', type: 'TimelineEngine', desc: 'The engine.' },
            { name: 'clipId', type: 'string', desc: 'The clip to resize.' },
            { name: 'expectedFallbackFrames', type: 'number', desc: 'The length it was inserted with. If the clip no longer has this length, the user has trimmed it, and it is left alone.' },
            { name: 'newDurationSec', type: 'number', desc: 'The real length, in seconds.' },
          ]}
        />
        <Bullets
          items={[
            'It never creates an overlap: the clip only grows up to the next clip on its track. It can also shrink a clip.',
            <>
              While the asset is pending, and while the preview is still opening the file, the clip shows a loading shimmer (the{' '}
              <C>.elah-clip-shimmer</C> class in <C>@elah/timeline/styles.css</C>). That loading state lives in <C>clipLoadStore</C>; it is never
              saved in the project or the undo history.
            </>,
          ]}
        />

        <DocsPager href="/docs/clips" />
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
