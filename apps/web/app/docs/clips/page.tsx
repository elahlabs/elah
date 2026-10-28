import type { Metadata } from 'next'
import Link from 'next/link'
import { CodeBlock } from '@/components/docs/CodeBlock'
import { DocsToc } from '@/components/docs/DocsToc'
import { PageHeader } from '@/components/site/PageHeader'

export const metadata: Metadata = {
  title: 'Clips & Tracks',
  description:
    'Multiple video tracks, clip speed, crop, corner radius, protected and pinned tracks, and growing a clip once its remote media has been probed.',
  alternates: { canonical: '/docs/clips' },
}

const toc = [
  { id: 'multiple-video-tracks', title: 'Multiple Video Tracks', level: 2 },
  { id: 'speed', title: 'Speed', level: 2 },
  { id: 'crop', title: 'Crop', level: 2 },
  { id: 'corner-radius', title: 'Corner Radius', level: 2 },
  { id: 'protected-and-pinned-tracks', title: 'Protected & Pinned Tracks', level: 2 },
  { id: 'growing-clips', title: 'Growing Clips', level: 2 },
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

export default function ClipsPage() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <article className="min-w-0 flex-1 max-w-3xl">
        <PageHeader
          variant="doc"
          eyebrow="Engine &amp; data"
          title="Clips &amp; Tracks"
          lede={
            <>
              What changed on the clip and track model in 0.6.0: more than one video lane, clip speed, a crop window, rounded corners, and tracks that the user cannot remove or that stay at the bottom.
            </>
          }
        />

        {/* Multiple video tracks */}
        <section className="mb-10">
          <H2 id="multiple-video-tracks">Multiple Video Tracks</H2>
          <P>
            Before 0.6.0 the engine capped a project at one video track and <C>addTrack(&apos;video&apos;)</C> returned the existing one. It now adds another lane. Overlapping clips on separate video lanes layer instead of conflicting.
          </P>
          <P>
            Video tracks composite in track order: the resolver derives each clip&apos;s z-index from <C>track.order</C>, and a lower <C>order</C> is closer to the top of the timeline, so the topmost lane draws on top. A new video track is placed directly below the last existing video track, which keeps the video lanes grouped above audio and elements. Every other kind of track is appended below all existing tracks.
          </P>
          <CodeBlock
            language="typescript"
            code={`const base = engine.addTrack('video', { name: 'Base' })
const pip = engine.addTrack('video', { name: 'Picture in picture' })
// pip is placed directly below base, so base draws on top of it.

// To put pip on top, give reorderTracks the COMPLETE list of track ids,
// topmost first. Tracks left out of the list keep a stale order value.
const rest = engine
  .getProject()
  .tracks.map((t) => t.id)
  .filter((id) => id !== pip.id)
engine.reorderTracks([pip.id, ...rest])`}
          />
          <p className="mt-4 text-sm leading-relaxed text-on-surface-variant">
            You can also start with several video lanes by listing them in <C>initialTracks</C>. The headless build spec in <Link href="/docs/cli#build-spec" className="text-on-surface underline decoration-primary underline-offset-4 hover:decoration-2">the CLI docs</Link> is separate: it still places every video clip on one video track, even though the engine itself supports more.
          </p>
        </section>

        {/* Speed */}
        <section className="mb-10">
          <H2 id="speed">Speed</H2>
          <P>
            <C>Clip.speed</C> is a playback-rate multiplier for <strong className="text-on-surface font-medium">video clips only</strong>. Omitted means 1. The engine clamps it to 0.25 to 4. Change it with <C>engine.setClipSpeed</C>, not by writing the field alone, because the method also recomputes <C>durationFrames</C> so the clip&apos;s length on the timeline follows the new rate.
          </P>
          <CodeBlock
            language="typescript"
            code={`// clip.durationFrames is 150 at 1x
engine.setClipSpeed(clip.id, trackId, 2)
// -> speed 2, durationFrames 75: the same source window, consumed twice as fast

engine.setClipSpeed(clip.id, trackId, 0.5)
// -> slows down; the clip grows, but never into the next clip on the track`}
          />
          <ul className="mt-4 mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>
              <C>sourceStartFrame</C> and <C>sourceDurationFrames</C> keep describing the trim window into the source at 1x. Only the rate at which that window is consumed changes.
            </li>
            <li>
              Speeding up always shrinks the clip in place. Slowing down grows it, clamped to the gap before the next clip on the same track. There is no ripple.
            </li>
            <li>
              It is a no-op on a locked track and on any clip that is not a video clip. Transitions that no longer make sense after the length change are pruned in the same undo entry.
            </li>
            <li>
              The resolver maps a timeline frame to a source frame as <C>floor(localFrame * speed) + sourceStartFrame</C>, and the export worker honours the same speed, so preview and export agree.
            </li>
          </ul>
        </section>

        {/* Crop */}
        <section className="mb-10">
          <H2 id="crop">Crop</H2>
          <P>
            <C>Clip.crop</C> is a window into the source, normalized 0 to 1 of the media&apos;s natural size with the origin at the top left. Omitted means the full frame. It applies to video and image clips.
          </P>
          <CodeBlock
            language="typescript"
            code={`import { normalizeCrop, FULL_CROP, type CropRect } from '@elah/editor'

// Keep the middle half of the source horizontally.
const crop: CropRect = { x: 0.25, y: 0, width: 0.5, height: 1 }
engine.updateClip(clip.id, trackId, { crop })

// normalizeCrop clamps a window into the unit square and enforces a minimum
// extent of 0.05 on each axis. normalizeCrop(undefined) returns FULL_CROP.
const safe = normalizeCrop({ x: 0.9, y: 0, width: 0.5, height: 1 })
// -> { x: 0.5, y: 0, width: 0.5, height: 1 }`}
          />
          <P>
            Cropping changes what is visible, not the clip&apos;s scale. The draw rect is sized from the cropped content, so a crop shrinks the box on stage while <C>transform.scale</C> stays as authored. The interactive crop mode in the preview is covered on the <Link href="/docs/editor#transforms" className="text-on-surface underline decoration-primary underline-offset-4 hover:decoration-2">Editor page</Link>.
          </P>
          <P>
            If you build your own placement UI, <C>transformFromContainRect(contentWidth, contentHeight, stageWidth, stageHeight)</C> returns the explicit <C>Transform</C> that is visually identical to the renderer&apos;s default contain placement. Bake it in before the first gesture and grabbing a clip that never had a transform does not make it jump. <C>transformFromCoverRect</C> takes the same arguments and fills the stage instead of letterboxing.
          </P>
        </section>

        {/* Corner radius */}
        <section className="mb-10">
          <H2 id="corner-radius">Corner Radius</H2>
          <P>
            <C>Clip.cornerRadius</C> rounds the corners of a video or image clip. It is a fraction from 0 to 0.5 of the shorter rendered side. 0, or omitted, is square. 0.5 is a full ellipse, which on a square draw rect is a circle.
          </P>
          <CodeBlock
            language="typescript"
            code={`engine.updateClip(clip.id, trackId, { cornerRadius: 0.12 })`}
          />
        </section>

        {/* Protected and pinned */}
        <section className="mb-10">
          <H2 id="protected-and-pinned-tracks">Protected &amp; Pinned Tracks</H2>
          <P>
            Two optional <C>Track</C> fields describe a fixed layout.
          </P>
          <ul className="mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>
              <C>protected: true</C> means the track cannot be removed. <C>engine.removeTrack</C> is a no-op for it.
            </li>
            <li>
              <C>pinned: &apos;bottom&apos;</C> keeps the lane, and any other pinned-bottom lane, below every non-pinned track. A new non-video track slots in just above the pinned block instead of after it, so freely added tracks land in the middle and a fixed audio bar stays at the very bottom.
            </li>
          </ul>
          <P>
            Both are accepted by <C>addTrack</C> options and by <C>InitialTrackConfig</C>, and both round-trip through <C>readProjectDocument</C>.
          </P>
          <CodeBlock
            language="tsx"
            code={`import { EditorProvider, type InitialTrackConfig } from '@elah/editor'

const tracks: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video' },
  { kind: 'audio', name: 'Audio', protected: true, pinned: 'bottom' },
]

<EditorProvider fps={30} initialTracks={tracks}>{/* ... */}</EditorProvider>

// Or after construction:
engine.addTrack('audio', { name: 'Music', pinned: 'bottom' })`}
          />
        </section>

        {/* Growing clips */}
        <section className="mb-10">
          <H2 id="growing-clips">Growing Clips</H2>
          <P>
            A remote URL can be placed on the timeline before its real duration is known. <C>beginImportUrl</C> from <C>@elah/core</C> registers the URL as a <C>status: &apos;pending&apos;</C> asset immediately, with a 5 second placeholder duration for video and audio, and finishes probing in the background. Insert a clip with the fallback length, then call <C>growClipToAssetDuration</C> from <C>@elah/timeline</C> once the asset is ready.
          </P>
          <CodeBlock
            language="typescript"
            code={`import {
  beginImportUrl,
  mediaLibraryStore,
  insertMediaAsset,
  growClipToAssetDuration,
} from '@elah/editor'

const asset = await beginImportUrl(url) // pending: durationSec is a placeholder
const result = await insertMediaAsset(engine, asset.id, { videoOnly: true })
if (!result.ok) return

const clipId = result.clipIds[0]
// Read the length the clip was actually inserted with. It can be shorter than
// the placeholder if the gap on the track was small.
const fallbackFrames = engine.findClip(clipId)!.clip.durationFrames

const unsubscribe = mediaLibraryStore.subscribe((state) => {
  const ready = state.assets[asset.id]
  if (ready?.status !== 'ready') return
  unsubscribe()
  growClipToAssetDuration(engine, clipId, fallbackFrames, ready.durationSec)
})`}
          />
          <ul className="mt-4 mb-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant">
            <li>
              The signature is <C>growClipToAssetDuration(engine, clipId, expectedFallbackFrames, newDurationSec)</C>. It resizes up to the gap before the next clip on the same track, so it never creates an overlap, and it can shrink a clip as well as grow it.
            </li>
            <li>
              If the clip&apos;s length no longer equals <C>expectedFallbackFrames</C>, the user has already trimmed it and it is left alone.
            </li>
            <li>
              While the asset is pending, and while the preview&apos;s decoder is still opening, a video or image clip shows a loading shimmer. The sweep is the <C>.elah-clip-shimmer</C> class in <C>@elah/timeline/styles.css</C>. The decoder-side wait is reported by <C>clipLoadStore</C>, which is renderer state and never part of the project or undo history.
            </li>
          </ul>
        </section>
      </article>

      <DocsToc items={toc} />
    </div>
  )
}
