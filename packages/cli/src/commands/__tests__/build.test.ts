import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Project } from '@elah/core'
import { runBuild } from '../build'
import { CliError } from '../../lib/errors'

// Text-only specs exercise the whole build pipe without any media probing.
describe('runBuild (orchestration, no media)', () => {
  it('builds a text-only spec to a valid project file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elah-build-test-'))
    const specPath = join(dir, 'spec.json')
    writeFileSync(
      specPath,
      JSON.stringify({ fps: 30, clips: [{ track: 'text', text: 'Hi', start: 0.5, duration: 2 }] })
    )
    const out = join(dir, 'project.json')
    await runBuild({ spec: specPath, out, headed: false, verbose: false })

    const project = JSON.parse(readFileSync(out, 'utf8')) as Project
    const clip = Object.values(project.clips).flat()[0]
    expect(clip.content).toBe('Hi')
    expect(clip.startFrame).toBe(15)
    expect(clip.durationFrames).toBe(60)
    expect(project.version).toBe(1)
  })

  it('requires --out or --export (exit 2)', async () => {
    try {
      await runBuild({ spec: 'x.json', headed: false, verbose: false })
      expect.unreachable()
    } catch (err) {
      expect((err as CliError).exitCode).toBe(2)
    }
  })

  it('names a referenced-but-unmapped asset', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elah-build-test-'))
    const specPath = join(dir, 'spec.json')
    writeFileSync(
      specPath,
      JSON.stringify({ clips: [{ track: 'video', asset: 'phantom', start: 0, duration: 1 }] })
    )
    try {
      await runBuild({ spec: specPath, out: join(dir, 'p.json'), headed: false, verbose: false })
      expect.unreachable()
    } catch (err) {
      expect((err as CliError).message).toContain("'phantom'")
      expect((err as CliError).message).toContain('missing from the assets map')
    }
  })
})
