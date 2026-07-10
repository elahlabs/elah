import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Project } from '@elah/core'
import { runTrim, type TrimArgs } from './trim'
import { CliError } from '../lib/errors'

const fixture = fileURLToPath(new URL('../__fixtures__/single-video.json', import.meta.url))

function trimToTmp(args: Omit<TrimArgs, 'project' | 'out'>): Project {
  const out = join(mkdtempSync(join(tmpdir(), 'elah-trim-')), 'out.json')
  runTrim({ project: fixture, out, ...args })
  return JSON.parse(readFileSync(out, 'utf8')) as Project
}

describe('runTrim', () => {
  it('trims duration only', () => {
    const project = trimToTmp({ clip: 'clip1', duration: '100' })
    const clip = project.clips['track-video'][0]
    expect(clip.startFrame).toBe(0)
    expect(clip.durationFrames).toBe(100)
  })

  it('moves the start and adjusts the source window', () => {
    const project = trimToTmp({ clip: 'clip1', start: '30', duration: '100' })
    const clip = project.clips['track-video'][0]
    expect(clip.startFrame).toBe(30)
    expect(clip.durationFrames).toBe(100)
    // dragging the left edge right by 30 advances the source in-point
    expect(clip.sourceStartFrame).toBe(30)
  })

  it('clamps duration to the source bounds for media clips', () => {
    // clip2 is the last clip on the track, so growth cannot overlap anything
    const project = trimToTmp({ clip: 'clip2', duration: '9999' })
    const clip = project.clips['track-video'].find((c) => c.id === 'clip2')!
    // engine clamps media clips at sourceDurationFrames (300)
    expect(clip.durationFrames).toBe(300)
  })

  it('surfaces the engine silent no-op (overlap) as exit 1', () => {
    // clip1 grown to 200 frames would overlap clip2 at frame 180
    try {
      trimToTmp({ clip: 'clip2', start: '100', duration: '90' })
      // clip2 moved to 100..190 does NOT overlap clip1 (0..150)? it does: 100 < 150 → rejected
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(CliError)
      expect((err as CliError).exitCode).toBe(1)
      expect((err as CliError).message).toContain('rejected')
    }
  })

  it('requires at least one of --start/--duration (exit 2)', () => {
    try {
      runTrim({ project: fixture, clip: 'clip1' })
      expect.unreachable()
    } catch (err) {
      expect((err as CliError).exitCode).toBe(2)
    }
  })

  it('rejects duration < 1 (exit 2)', () => {
    expect(() => trimToTmp({ clip: 'clip1', duration: '0' })).toThrow(/at least 1/)
  })
})
