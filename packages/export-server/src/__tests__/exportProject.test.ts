import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Project, Track, Clip } from '@elah/core'
import { createCanvas } from '@napi-rs/canvas'

import { exportProject } from '../exportProject'

const execFileAsync = promisify(execFile)

/**
 * A real, un-mocked run of `exportProject` against a project whose single
 * clip is a relative-path image src — the exact shape that reproduces the
 * imageSources key-mismatch regression (plan.ts resolved the src for the
 * lookup map, but FrameCompositor looks images up by the raw Scene src).
 * Before the fix this exported an all-black frame with no error, no warning,
 * and a correct frame count/duration — silent enough that only reading the
 * actual pixels back out catches it.
 *
 * Runs against the system ffmpeg (present in dev/CI per this package's own
 * requirement) rather than mocking child_process: the whole point is to
 * observe what actually lands in the muxed output, which a mocked spawn
 * cannot tell us.
 */
describe('exportProject (image clip integration)', () => {
  it('composites a relative-src image clip instead of silently dropping it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'elah-export-server-'))
    try {
      const assetsDir = join(dir, 'assets')
      await mkdir(assetsDir, { recursive: true })

      // A solid red 16x16 PNG — anything decisively non-black at the center
      // pixel is enough to prove the image actually composited.
      const canvas = createCanvas(16, 16)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ff0000'
      ctx.fillRect(0, 0, 16, 16)
      await writeFile(join(assetsDir, 'logo.png'), canvas.toBuffer('image/png'))

      const track: Track = {
        id: 't1',
        name: 'V',
        kind: 'video',
        order: 0,
        height: 64,
        locked: false,
        disabled: false,
        muted: false,
        solo: false,
      }
      const clip: Clip = {
        id: 'img1',
        trackId: 't1',
        type: 'image',
        name: 'logo',
        startFrame: 0,
        durationFrames: 3,
        sourceStartFrame: 0,
        sourceDurationFrames: 3,
        // Relative — resolveSource(projectDir, src) rewrites this to an
        // absolute path distinct from the raw Scene src the compositor sees.
        src: 'assets/logo.png',
        transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 } },
      }
      const project: Project = {
        id: 'p1',
        fps: 5,
        stage: { width: 16, height: 16 },
        tracks: [track],
        clips: { t1: [clip] },
        transitions: [],
        version: 1,
      }

      const outPath = join(dir, 'out.mp4')
      const result = await exportProject(project, { outPath, projectDir: dir })

      expect(result.warnings.filter(w => w.toLowerCase().includes('image'))).toEqual([])

      // Pull the first frame's raw pixels back out and check the center is
      // red, not the opaque black background — the failure mode is a fully
      // black frame for the image's entire duration.
      const { stdout } = await execFileAsync(
        'ffmpeg',
        ['-hide_banner', '-loglevel', 'error', '-i', outPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'],
        { encoding: 'buffer', maxBuffer: 1024 * 1024 },
      )
      const pixels = stdout as unknown as Buffer
      const width = result.width
      const cx = Math.floor(width / 2)
      const cy = Math.floor(result.height / 2)
      const i = (cy * width + cx) * 4
      const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]]

      expect(r).toBeGreaterThan(150)
      expect(g).toBeLessThan(100)
      expect(b).toBeLessThan(100)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
