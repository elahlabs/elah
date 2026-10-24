/**
 * PV-P4a-2: the main thread's half of the font preload contract.
 *
 * Two things are load-bearing here and neither is visible from the worker:
 *
 *  1. `onFontIssue` must be STRIPPED from the posted options. `postMessage`
 *     throws `DataCloneError` on a function, so leaving it in does not degrade
 *     the export — it prevents the export from starting at all. The fake Worker
 *     below records the real payload, so an unstripped callback is a red test
 *     rather than a silently working one.
 *  2. The font base URL is resolved against the PAGE, not the worker script.
 *     A module worker resolves a relative URL against `/_next/static/...`, so an
 *     unresolved `/fonts/` would 404 in every real app while passing any test
 *     that never looked at the posted value.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportVideo } from '../exportVideo'
import { TimelineEngine } from '../../editor/TimelineEngine'

/** Records every postMessage payload and lets a test drive the worker's replies. */
class FakeWorker {
  static last: FakeWorker | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: { message: string }) => void) | null = null
  readonly posted: unknown[] = []
  terminated = false

  constructor() {
    FakeWorker.last = this
  }
  postMessage(data: unknown): void {
    this.posted.push(data)
  }
  terminate(): void {
    this.terminated = true
  }
  /** Deliver a worker→main message. */
  emit(data: unknown): void {
    this.onmessage?.({ data })
  }
}

/** The posted start message's options, or a hard failure naming what is missing. */
function postedOptions(worker: FakeWorker): Record<string, unknown> {
  const start = worker.posted[0] as { type?: string; options?: Record<string, unknown> } | undefined
  expect(start?.type).toBe('start')
  return start!.options!
}

/**
 * A project with one 15-frame text clip, through the real engine.
 *
 * The clip is created and THEN patched, not created with `fontId`, because
 * `createClip` is a closed factory: `TextClipMetadata` (elements/base.ts) is a
 * fixed field list and a field it does not name is dropped without a word. That
 * is the P1d trap, it is unchanged here on purpose — `elements/base.ts` is not in
 * this ticket's allowlist and the picker that would create such a clip is
 * PV-P4b's. `updateClip` patches the stored clip, so `fontId` survives, and this
 * is the same two-step the ticket's own harness step describes.
 */
function project() {
  const engine = new TimelineEngine({ fps: 30 })
  const track = engine.addTrack('elements', { name: 'Text' })
  const clip = engine.addClip({
    type: 'text',
    text: { content: 'TITLE' },
    trackId: track.id,
    startFrame: 0,
    durationFrames: 15,
  })
  engine.updateClip(clip.id, track.id, { fontId: 'bebas-neue' })
  const stored = engine.getProject()
  // Guard the guard: if the factory or the patch silently dropped the field,
  // every assertion below would pass against a project that names no font.
  expect(stored.clips[track.id]![0]!.fontId).toBe('bebas-neue')
  return stored
}

/** Let exportVideo's awaits settle so the worker has been created and posted to. */
const settle = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => {
  vi.unstubAllGlobals()
  FakeWorker.last = null
})

describe('exportVideo — bundled fonts (PV-P4a-2)', () => {
  it('posts an absolute default base URL and no callback, and finishes the video', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('location', { href: 'http://localhost:3001/editor' })
    const issues: string[] = []

    const done = exportVideo(project(), { onFontIssue: (m) => issues.push(m) })
    await settle()
    const worker = FakeWorker.last!
    expect(worker).not.toBeNull()

    // The default '/fonts/' is made absolute against the PAGE, not the script.
    expect((postedOptions(worker).fonts as { baseUrl: string }).baseUrl).toBe('http://localhost:3001/fonts/')
    // A function here would throw DataCloneError and the worker would never run.
    expect(postedOptions(worker).onFontIssue).toBeUndefined()
    expect(postedOptions(worker).onProgress).toBeUndefined()
    expect(postedOptions(worker).onAudioIssue).toBeUndefined()

    // A warning is reported and is NOT terminal: the export still resolves.
    worker.emit({ type: 'warning', message: 'm1' })
    expect(issues).toEqual(['m1'])

    worker.emit({ type: 'done', buffer: new ArrayBuffer(8) })
    const blob = await done
    expect(blob.size).toBe(8)
    expect(worker.terminated).toBe(true)
  })

  it('resolves a caller-supplied base URL and normalises its trailing slash', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('location', { href: 'http://localhost:3001/editor' })

    const done = exportVideo(project(), { fonts: { baseUrl: 'https://cdn.example.com/f' } })
    await settle()
    const worker = FakeWorker.last!
    expect((postedOptions(worker).fonts as { baseUrl: string }).baseUrl).toBe('https://cdn.example.com/f/')

    // exportVideo refuses a second export while one is in flight, so this one
    // has to be finished before the next test can start its own.
    worker.emit({ type: 'done', buffer: new ArrayBuffer(1) })
    expect((await done).size).toBe(1)
  })

  it('survives a project that names no font, with no warning of its own', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('location', { href: 'http://localhost:3001/editor' })
    const issues: string[] = []

    // The base URL is posted unconditionally — it is a plain string, so it
    // cannot fail the clone, and the WORKER decides whether to use it. What
    // matters is that a project with no `fontId` produces no font request and
    // no issue; that decision is the worker's, proved in ExportWorker's own path.
    const done = exportVideo(project(), { onFontIssue: (m) => issues.push(m) })
    await settle()
    const worker = FakeWorker.last!
    expect(issues).toEqual([])
    worker.emit({ type: 'done', buffer: new ArrayBuffer(2) })
    expect((await done).size).toBe(2)
  })
})
