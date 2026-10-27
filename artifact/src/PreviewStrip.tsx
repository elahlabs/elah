import { useEffect, useMemo, useRef } from 'react'
import { usePlaybackStore, useTracksStore, type Clip } from '@elah/editor'

interface Scene {
  name: string
  start: number
  end: number
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** More bars than this reads as noise in a preview strip; the rail and playhead stay. */
const MAX_SCENES = 16

/**
 * Scene bars for the editor's Preview mode. A converted programmatic video names its clips `scene · element`, so
 * the prefix groups them back into the scenes the first-load strip showed; anything else falls back to one bar per
 * clip name. Frames, not seconds.
 */
function scenesOf(clips: Record<string, Clip[]>, total: number): Scene[] {
  const all = Object.values(clips).flat()
  const named = all.filter((c) => c.name.includes(' · '))
  // Without scene names, whole-video layers (background, ambient glow) are not scenes: leave them out.
  const source = named.length > 0 ? named : all.filter((c) => c.durationFrames < total * 0.9)
  const byName = new Map<string, Scene>()
  for (const c of source) {
    const name = named.length > 0 ? c.name.split(' · ')[0] : c.name
    const s = byName.get(name)
    const end = c.startFrame + c.durationFrames
    if (s) {
      s.start = Math.min(s.start, c.startFrame)
      s.end = Math.max(s.end, end)
    } else byName.set(name, { name, start: c.startFrame, end })
  }
  const scenes = [...byName.values()].sort((a, b) => a.start - b.start)
  return scenes.length > MAX_SCENES ? [] : scenes
}

/** Greedy lane packing so overlapping scenes stack instead of covering each other (same rule as PagePlayer). */
function lanes(scenes: readonly Scene[]): number[] {
  const ends: number[] = []
  return scenes.map((s) => {
    let lane = ends.findIndex((e) => e <= s.start)
    if (lane === -1) lane = ends.length
    ends[lane] = s.end
    return lane
  })
}

/**
 * The compact scrub strip shown in Preview: a rail, scene bars and a playhead, in the same look as the
 * programmatic video's first-load strip (`.page-timeline`). Edit shows the full multi-track timeline instead.
 */
export function PreviewStrip() {
  const clips = useTracksStore((s) => s.clips)
  const total = Math.max(1, useTracksStore((s) => s.totalFrames))
  const scenes = useMemo(() => scenesOf(clips, total), [clips, total])
  const laneOf = useMemo(() => lanes(scenes), [scenes])
  const laneCount = scenes.length ? Math.max(1, ...laneOf.map((l) => l + 1)) : 0
  const trackRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const paint = (f: number) => {
      const pct = `${clamp(f / total, 0, 1) * 100}%`
      if (playheadRef.current) playheadRef.current.style.left = pct
      if (fillRef.current) fillRef.current.style.width = pct
    }
    paint(usePlaybackStore.getState().currentFrame)
    return usePlaybackStore.subscribe((s) => paint(s.currentFrame))
  }, [total])

  const scrubbing = useRef<{ resume: boolean } | null>(null)
  const frameAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect()
    return Math.round(clamp((clientX - r.left) / r.width, 0, 1) * total)
  }
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const pb = usePlaybackStore.getState()
    scrubbing.current = { resume: pb.isPlaying }
    if (pb.isPlaying) pb.pause()
    pb.setCurrentFrame(frameAt(e.clientX))
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubbing.current) usePlaybackStore.getState().setCurrentFrame(frameAt(e.clientX))
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbing.current) return
    const { resume } = scrubbing.current
    scrubbing.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (resume) usePlaybackStore.getState().togglePlayPause()
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const pb = usePlaybackStore.getState()
    const step = e.shiftKey ? 10 : 1
    if (e.key === 'ArrowLeft') pb.setCurrentFrame(Math.max(0, pb.currentFrame - step))
    else if (e.key === 'ArrowRight') pb.setCurrentFrame(Math.min(total, pb.currentFrame + step))
    else if (e.key === 'Home') pb.setCurrentFrame(0)
    else if (e.key === 'End') pb.setCurrentFrame(total)
    else return
    e.preventDefault()
  }

  return (
    <div className="page-timeline" data-testid="preview-strip" style={{ height: 22 + laneCount * 24 }}>
      <div
        className="pt-track"
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Playhead"
        aria-valuemin={0}
        aria-valuemax={total}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <div className="pt-rail"><div className="pt-fill" ref={fillRef} /></div>
        <div className="pt-scenes">
          {scenes.map((s, i) => (
            <div
              key={`${s.name}-${i}`}
              className="pt-scene"
              style={{
                left: `${(s.start / total) * 100}%`,
                width: `${Math.max(0.5, ((s.end - s.start) / total) * 100)}%`,
                top: laneOf[i] * 24,
              }}
              title={s.name}
            >
              <span>{s.name}</span>
            </div>
          ))}
        </div>
        <div className="pt-playhead" ref={playheadRef} />
      </div>
    </div>
  )
}
