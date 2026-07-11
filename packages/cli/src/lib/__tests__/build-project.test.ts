import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProject } from '../build-project'
import { CliError } from '../errors'

// Text-only specs exercise the whole build pipe without any media probing.
describe('buildProject (orchestration, no media)', () => {
  it('builds a text-only spec to a valid project', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elah-build-project-test-'))
    const spec = { fps: 30, clips: [{ track: 'text', text: 'Hi', start: 0.5, duration: 2 }] }

    const { project, summary } = await buildProject({ spec, baseDir: dir })

    const clip = Object.values(project.clips).flat()[0]
    expect(clip.content).toBe('Hi')
    expect(clip.startFrame).toBe(15)
    expect(clip.durationFrames).toBe(60)
    expect(project.version).toBe(1)
    expect(summary).toEqual({ tracks: project.tracks.length, clips: 1, totalFrames: 75, fps: 30 })
  })

  it('names a referenced-but-unmapped asset', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elah-build-project-test-'))
    const spec = { clips: [{ track: 'video', asset: 'phantom', start: 0, duration: 1 }] }

    try {
      await buildProject({ spec, baseDir: dir })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(CliError)
      expect((err as CliError).message).toContain("'phantom'")
      expect((err as CliError).message).toContain('missing from the assets map')
    }
  })

  it('rejects an invalid spec shape with a path-addressed message', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elah-build-project-test-'))
    const spec = { clips: [{ track: 'bogus', start: 0 }] }

    try {
      await buildProject({ spec, baseDir: dir })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(CliError)
      expect((err as CliError).message).toContain('Invalid spec:')
      expect((err as CliError).message).toContain('clips[0].track')
    }
  })
})
