import { describe, expect, it } from 'vitest'
import type { ProjectComposition } from '../composition/types'
import type { Clip, Project, Track } from '../types'
import { renderVariants, type VariantProgress, type VariantResult } from './renderVariants'
import type { ExportOptions } from './types'

function track(id: string, order: number): Track {
  return { id, name: id, kind: 'elements', order, height: 54, locked: false, disabled: false, muted: false, solo: false }
}

function makeFixture(): Project {
  const t1: Clip = {
    id: 't1', trackId: 'e1', type: 'text', name: 'Title', content: 'Hello', color: '#ffffff',
    startFrame: 0, durationFrames: 30, sourceStartFrame: 0, sourceDurationFrames: 30,
  } as unknown as Clip

  const composition: ProjectComposition = {
    props: [
      { name: 'title', type: 'text', default: 'Hello', label: 'Title' },
      { name: 'accent', type: 'color', default: '#3366ff', label: 'Accent' },
    ],
    bindings: [{ clipId: 't1', path: 'text', prop: 'title' }],
  }

  return {
    id: 'p', fps: 30, stage: { width: 1080, height: 1920 },
    tracks: [track('e1', 0)], clips: { e1: [t1] }, transitions: [], version: 1,
    composition,
  } as unknown as Project
}

function findClip(p: Project, id: string): Clip {
  for (const bucket of Object.values(p.clips)) {
    const found = bucket.find((c) => c.id === id)
    if (found) return found
  }
  throw new Error(`clip "${id}" not found`)
}

async function collect(gen: AsyncGenerator<VariantResult, void, undefined>): Promise<VariantResult[]> {
  const out: VariantResult[] = []
  for await (const r of gen) out.push(r)
  return out
}

/** Records calls, tracks the max simultaneous in-flight count, emits one
 *  progress tick, and resolves a Blob — the ticket's fake exporter. */
function makeExporter() {
  const calls: Array<{ project: Project; options: ExportOptions }> = []
  let inFlight = 0
  let maxInFlight = 0
  const exporter = async (project: Project, options: ExportOptions): Promise<Blob> => {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    calls.push({ project, options })
    options.onProgress?.({ frame: 5, totalFrames: 10 })
    await Promise.resolve()
    await Promise.resolve()
    inFlight--
    return new Blob(['x'])
  }
  return { exporter, calls, maxInFlight: () => maxInFlight }
}

describe('renderVariants', () => {
  it('renders each row one at a time, skipping a row with a validation error', async () => {
    const project = makeFixture()
    const fake = makeExporter()
    const outerProgress: VariantProgress[] = []
    const controller = new AbortController()

    const results = await collect(renderVariants(
      project,
      [
        { values: { title: 'A' }, name: 'a' },
        { values: { title: 'B', accent: 'nope' } },
        { values: { title: 'C' } },
      ],
      {
        export: { outputHeight: 360 },
        exporter: fake.exporter,
        signal: controller.signal,
        onProgress: (p) => outerProgress.push(p),
      },
    ))

    expect(results).toHaveLength(3)
    expect(results[0]).toMatchObject({ index: 0, name: 'a', ok: true })
    expect(results[1]!.ok).toBe(false)
    expect((results[1] as { error: string }).error).toMatch(/Accent|accent/)
    expect(results[2]).toMatchObject({ index: 2, ok: true })

    // The exporter was never called for the invalid row (index 1): 2 calls, not 3.
    expect(fake.calls).toHaveLength(2)
    expect(findClip(fake.calls[0]!.project, 't1').content).toBe('A')
    expect(findClip(fake.calls[1]!.project, 't1').content).toBe('C')
    expect(fake.calls[0]!.options.signal).toBe(controller.signal)
    expect(fake.calls[0]!.options.outputHeight).toBe(360)
    expect(fake.maxInFlight()).toBe(1)
    expect(outerProgress[0]).toEqual({ index: 0, frame: 5, totalFrames: 10 })
  })

  it('reports a rejecting exporter as that row\'s error, and keeps rendering later rows', async () => {
    const project = makeFixture()
    let call = 0
    const exporter = async (): Promise<Blob> => {
      call++
      if (call === 1) throw new Error('boom')
      return new Blob(['x'])
    }

    const results = await collect(renderVariants(
      project,
      [{ values: { title: 'A' } }, { values: { title: 'B' } }],
      { exporter },
    ))

    expect(results[0]).toMatchObject({ index: 0, ok: false, error: 'boom' })
    expect(results[1]).toMatchObject({ index: 1, ok: true })
  })

  it('rejects with an AbortError when aborted mid-row, keeping only the results before it', async () => {
    const project = makeFixture()
    const controller = new AbortController()
    let calls = 0
    const exporter = (_project: Project, options: ExportOptions): Promise<Blob> => {
      calls++
      if (calls === 1) {
        options.onProgress?.({ frame: 5, totalFrames: 10 })
        return Promise.resolve(new Blob(['x']))
      }
      // Row 1: emit one progress tick (the test aborts from it — synchronously,
      // so the signal is already aborted by the time the promise below is
      // constructed), then hang until the signal fires, mirroring a real
      // in-flight export's abort path.
      options.onProgress?.({ frame: 1, totalFrames: 10 })
      return new Promise((_resolve, reject) => {
        if (options.signal?.aborted) {
          reject(options.signal.reason ?? new DOMException('Export aborted', 'AbortError'))
          return
        }
        options.signal?.addEventListener('abort', () => {
          reject(new DOMException('Export aborted', 'AbortError'))
        })
      })
    }

    const gen = renderVariants(
      project,
      [{ values: { title: 'A' } }, { values: { title: 'B' } }, { values: { title: 'C' } }],
      {
        exporter,
        signal: controller.signal,
        onProgress: (p) => {
          if (p.index === 1) controller.abort()
        },
      },
    )

    const results: VariantResult[] = []
    let rejection: unknown
    try {
      for await (const r of gen) results.push(r)
    } catch (err) {
      rejection = err
    }

    expect((rejection as { name?: string } | undefined)?.name).toBe('AbortError')
    expect(results).toHaveLength(1)
    expect(results[0]!.index).toBe(0)
    expect(calls).toBe(2)
  })

  it('rejects the first next() when already aborted, without calling the exporter', async () => {
    const project = makeFixture()
    const controller = new AbortController()
    controller.abort()
    let called = false
    const exporter = async (): Promise<Blob> => {
      called = true
      return new Blob(['x'])
    }

    const gen = renderVariants(project, [{ values: { title: 'A' } }], { exporter, signal: controller.signal })
    await expect(gen.next()).rejects.toMatchObject({ name: 'AbortError' })
    expect(called).toBe(false)
  })

  it('accepts rows given as an async generator', async () => {
    const project = makeFixture()
    async function* rows() {
      yield { values: { title: 'A' } }
      yield { values: { title: 'B' } }
    }
    const exporter = async (): Promise<Blob> => new Blob(['x'])

    const results = await collect(renderVariants(project, rows(), { exporter }))
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.ok)).toBe(true)
  })

  it('does not mutate the input project', async () => {
    const project = makeFixture()
    const before = JSON.stringify(project)
    const exporter = async (): Promise<Blob> => new Blob(['x'])

    await collect(renderVariants(project, [{ values: { title: 'A' } }], { exporter }))
    expect(JSON.stringify(project)).toBe(before)
  })

  it('rejects the first next() for a project without a composition', async () => {
    const project = { ...makeFixture(), composition: undefined } as unknown as Project
    const gen = renderVariants(project, [{ values: {} }])
    await expect(gen.next()).rejects.toThrow(/no composition/)
  })
})
