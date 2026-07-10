import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readProject, writeProject, findClipTrack, resolveMediaSource } from './project-io'
import { CliError } from './errors'

const fixtures = fileURLToPath(new URL('../__fixtures__', import.meta.url))

function tmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'elah-cli-test-'))
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

describe('readProject', () => {
  it('loads a valid fixture', () => {
    const { project, dir } = readProject(join(fixtures, 'single-video.json'))
    expect(project.fps).toBe(30)
    expect(project.tracks).toHaveLength(1)
    expect(dir).toBe(fixtures)
  })

  it('fails with exit 1 on a missing file', () => {
    try {
      readProject('/nonexistent/project.json')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(CliError)
      expect((err as CliError).exitCode).toBe(1)
      expect((err as CliError).message).toContain('not found')
    }
  })

  it('fails on invalid JSON', () => {
    const path = tmpFile('bad.json', '{ not json')
    expect(() => readProject(path)).toThrow(/not valid JSON/)
  })

  it('fails on structural problems', () => {
    const cases: Array<[string, RegExp]> = [
      ['[]', /expected a JSON object/],
      ['{"id":"x"}', /'fps' must be a positive integer/],
      ['{"id":"x","fps":30}', /'stage'/],
      [
        JSON.stringify({
          id: 'x',
          fps: 30,
          stage: { width: 1, height: 1 },
          tracks: [],
          clips: { ghost: [] },
          transitions: [],
          version: 1,
        }),
        /unknown track 'ghost'/,
      ],
      [
        JSON.stringify({
          id: 'x',
          fps: 30,
          stage: { width: 1, height: 1 },
          tracks: [{ id: 't1' }],
          clips: { t1: [{ id: 'c1', startFrame: 0.5, durationFrames: 10, sourceStartFrame: 0, sourceDurationFrames: 10 }] },
          transitions: [],
          version: 1,
        }),
        /must be an integer frame count/,
      ],
      [
        JSON.stringify({
          id: 'x',
          fps: 30,
          stage: { width: 1, height: 1 },
          tracks: [{ id: 't1' }, { id: 't2' }],
          clips: {
            t1: [{ id: 'dup', startFrame: 0, durationFrames: 10, sourceStartFrame: 0, sourceDurationFrames: 10 }],
            t2: [{ id: 'dup', startFrame: 0, durationFrames: 10, sourceStartFrame: 0, sourceDurationFrames: 10 }],
          },
          transitions: [],
          version: 1,
        }),
        /duplicate clip id 'dup'/,
      ],
    ]
    for (const [content, pattern] of cases) {
      const path = tmpFile('case.json', content)
      expect(() => readProject(path), content).toThrow(pattern)
    }
  })
})

describe('findClipTrack', () => {
  it('finds a clip and its track', () => {
    const { project } = readProject(join(fixtures, 'single-video.json'))
    const { clip, trackId } = findClipTrack(project, 'clip2')
    expect(trackId).toBe('track-video')
    expect(clip.startFrame).toBe(180)
  })

  it('lists known ids when the clip is missing', () => {
    const { project } = readProject(join(fixtures, 'single-video.json'))
    expect(() => findClipTrack(project, 'nope')).toThrow(/Known clip ids: clip1, clip2/)
  })
})

describe('resolveMediaSource', () => {
  it('resolves relative paths against the project dir', () => {
    expect(resolveMediaSource('./media/a.mp4', '/proj')).toBe('/proj/media/a.mp4')
  })
  it('passes remote URLs through', () => {
    expect(resolveMediaSource('https://cdn.example.com/a.mp4', '/proj')).toBe(
      'https://cdn.example.com/a.mp4'
    )
  })
  it('keeps absolute paths', () => {
    expect(resolveMediaSource('/abs/a.mp4', '/proj')).toBe('/abs/a.mp4')
  })
  it('percent-decodes file:// URLs', () => {
    expect(resolveMediaSource('file:///media/My%20Video.mp4', '/proj')).toBe('/media/My Video.mp4')
  })
})

describe('writeProject', () => {
  it('wraps filesystem errors in a CliError instead of a stack trace', () => {
    const { project } = readProject(join(fixtures, 'single-video.json'))
    try {
      writeProject(project, '/nonexistent-dir/deep/out.json')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(CliError)
      expect((err as CliError).message).toContain('Cannot write')
    }
  })
})
