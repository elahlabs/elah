import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Project } from '@elah/core'
import { prepareMedia } from '../lib/render-session'
import { CliError } from '../lib/errors'

const fixturesDir = fileURLToPath(new URL('../__fixtures__', import.meta.url))
const fixturePath = join(fixturesDir, 'single-video.json')

function loadFixture(): Project {
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as Project
}

describe('prepareMedia', () => {
  it('fails before any browser work when local media is missing', () => {
    const project = loadFixture()
    try {
      prepareMedia(project, dirname(fixturePath), 'tok')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(CliError)
      expect((err as CliError).message).toContain('./media/sample.mp4')
      expect((err as CliError).message).toContain('resolved to')
    }
  })

  it('dedupes clips sharing a source into one token-guarded route', () => {
    const project = loadFixture()
    for (const clip of project.clips['track-video']) clip.src = 'https://cdn.example.com/a.mp4'
    const { exportProject, media } = prepareMedia(project, '/proj', 'tok')

    expect(media.size).toBe(1)
    const [route, target] = [...media.entries()][0]
    expect(route).toBe('/media/tok/0')
    expect(target).toBe('https://cdn.example.com/a.mp4')
    for (const clip of exportProject.clips['track-video']) expect(clip.src).toBe(route)
  })

  it('leaves the input project untouched and skips non-media clips', () => {
    const project = loadFixture()
    for (const clip of project.clips['track-video']) clip.src = 'https://cdn.example.com/a.mp4'
    const text = {
      ...project.clips['track-video'][0],
      id: 'caption',
      type: 'text' as const,
      src: 'not-a-real-media-src',
      startFrame: 300,
    }
    project.clips['track-video'] = [...project.clips['track-video'], text]

    const { exportProject } = prepareMedia(project, '/proj', 'tok')
    // original untouched
    expect(project.clips['track-video'][0].src).toBe('https://cdn.example.com/a.mp4')
    // text clip src is not treated as media
    expect(exportProject.clips['track-video'].find((c) => c.id === 'caption')!.src).toBe(
      'not-a-real-media-src'
    )
  })
})
