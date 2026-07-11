import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Project } from '@elah/core'
import { runTrim, type TrimArgs } from '../trim'
import { CliError } from '../../lib/errors'

const fixture = fileURLToPath(new URL('../../__fixtures__/single-video.json', import.meta.url))

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
    // moving clip2 to frames 100–190 collides with clip1 (frames 0–150)
    try {
      trimToTmp({ clip: 'clip2', start: '100', duration: '90' })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(CliError)
      expect((err as CliError).exitCode).toBe(1)
      expect((err as CliError).message).toContain('did not apply')
    }
  })

  it('names the source-bounds clamp as a possible cause when the edit lands on current values', () => {
    // single clip at startFrame 50 with sourceStartFrame 0: the left edge
    // cannot move left, so --start 30 is clamped back to exactly 50 and the
    // engine commits nothing — the error must not blame only overlap/locked
    const dir = mkdtempSync(join(tmpdir(), 'elah-clamp-'))
    const project = JSON.parse(readFileSync(fixture, 'utf8')) as Project
    project.clips['track-video'] = [
      { ...project.clips['track-video'][0], startFrame: 50 },
    ]
    const path = join(dir, 'clamp.json')
    writeFileSync(path, JSON.stringify(project))
    try {
      runTrim({ project: path, clip: 'clip1', start: '30' })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(CliError)
      expect((err as CliError).message).toContain('did not apply')
      expect((err as CliError).message).toContain('source bounds')
      expect((err as CliError).message).toContain('start=50')
    }
  })

  it('does not error when the request equals the current values', () => {
    const project = trimToTmp({ clip: 'clip1', start: '0', duration: '150' })
    expect(project.clips['track-video'][0].durationFrames).toBe(150)
  })

  it('rejects edits on a locked track with the real reason', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elah-locked-'))
    const project = JSON.parse(readFileSync(fixture, 'utf8')) as Project
    project.tracks[0] = { ...project.tracks[0], locked: true }
    const lockedPath = join(dir, 'locked.json')
    writeFileSync(lockedPath, JSON.stringify(project))
    try {
      runTrim({ project: lockedPath, clip: 'clip1', duration: '100' })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(CliError)
      expect((err as CliError).message).toContain('locked')
      expect((err as CliError).message).not.toContain('overlap')
    }
  })

  it('accepts timecode values for --start and --duration', () => {
    const project = trimToTmp({ clip: 'clip1', start: '01:00', duration: '03:00' })
    const clip = project.clips['track-video'][0]
    expect(clip.startFrame).toBe(30)
    expect(clip.durationFrames).toBe(90)
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
