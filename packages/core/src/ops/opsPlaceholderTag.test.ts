import { describe, expect, it } from 'vitest'
import { TimelineEngine } from '../editor/TimelineEngine'
import { applyOps } from './apply'
import type { EditorOp } from './types'

/**
 * `ApplyContext.placeholderTag` (AGN-P5): the web layer reads the tag back off
 * a placeholder's name to tell its own clip from one a user renamed.
 */

const op: EditorOp = { op: 'generateMedia', media: 'video', prompt: 'a drone shot over a city at dusk', at: 2, duration: 4 }

function placeholderName(ctx: Parameters<typeof applyOps>[2]): string {
  const engine = new TimelineEngine({ fps: 30 })
  const res = applyOps(engine, [op], ctx)
  return engine.findClip(res.deferred[0]!.placeholderClipId)!.clip.name
}

describe('placeholderTag', () => {
  it('leaves the placeholder name exactly as it was when absent', () => {
    expect(placeholderName({})).toBe('Generating video: a drone shot over a city at dusk')
  })

  it('appends the tag, built from the op, to the placeholder name', () => {
    expect(placeholderName({ placeholderTag: (o) => `[ai:step-1:${o.media}]` })).toBe('Generating video: a drone shot over a city at dusk [ai:step-1:video]')
  })
})
