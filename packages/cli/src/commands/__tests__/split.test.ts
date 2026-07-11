import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Project } from '@elah/core'
import { runSplit } from '../split'
import { CliError } from '../../lib/errors'

const fixture = fileURLToPath(new URL('../../__fixtures__/single-video.json', import.meta.url))

function splitToTmp(at: string): Project {
  const out = join(mkdtempSync(join(tmpdir(), 'elah-split-')), 'out.json')
  runSplit({ project: fixture, clip: 'clip1', at, out })
  return JSON.parse(readFileSync(out, 'utf8')) as Project
}

describe('runSplit', () => {
  it('splits a clip with core frame semantics (left keeps id, source window recomputed)', () => {
    const project = splitToTmp('60')
    const clips = project.clips['track-video']
    expect(clips).toHaveLength(3)

    const left = clips[0]
    const right = clips[1]
    expect(left.id).toBe('clip1')
    expect(left.startFrame).toBe(0)
    expect(left.durationFrames).toBe(60)
    expect(right.startFrame).toBe(60)
    expect(right.durationFrames).toBe(90)
    // right half's trim window starts where the left half ended
    expect(right.sourceStartFrame).toBe(60)
    expect(left.durationFrames + right.durationFrames).toBe(150)
  })

  it('accepts timecode positions (00:02:00 at 30fps = frame 60)', () => {
    const project = splitToTmp('00:02:00')
    expect(project.clips['track-video'][0].durationFrames).toBe(60)
  })

  it('rejects a split point on the clip boundary with exit 1', () => {
    for (const at of ['0', '150']) {
      try {
        splitToTmp(at)
        expect.unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(CliError)
        expect((err as CliError).exitCode).toBe(1)
        expect((err as CliError).message).toContain('strictly inside')
      }
    }
  })

  it('rejects an unknown clip id', () => {
    expect(() => runSplit({ project: fixture, clip: 'ghost', at: '10' })).toThrow(/not found/)
  })

  it('rejects a locked track with the real reason, not a guess', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elah-split-locked-'))
    const project = JSON.parse(readFileSync(fixture, 'utf8')) as Project
    project.tracks[0] = { ...project.tracks[0], locked: true }
    const path = join(dir, 'locked.json')
    writeFileSync(path, JSON.stringify(project))
    try {
      runSplit({ project: path, clip: 'clip1', at: '60' })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(CliError)
      expect((err as CliError).message).toContain('locked')
      expect((err as CliError).message).not.toContain('strictly inside')
    }
  })

  it('supports in-place --out (same path as --project)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elah-split-inplace-'))
    const path = join(dir, 'project.json')
    writeFileSync(path, readFileSync(fixture))
    runSplit({ project: path, clip: 'clip1', at: '60', out: path })
    const project = JSON.parse(readFileSync(path, 'utf8')) as Project
    expect(project.clips['track-video']).toHaveLength(3)
  })
})
