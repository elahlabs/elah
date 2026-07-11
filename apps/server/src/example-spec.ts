import { join } from 'node:path'
import { probeMedia, type BuildSpec } from '@elah/cli'

const SCENE_COUNT = 5

/**
 * Assembles a demo BuildSpec from the local scene-*.mp4 / audio.mp3 /
 * logo-single.png assets. Scene durations aren't known ahead of time, so
 * clips are probed and placed back-to-back rather than hardcoded.
 */
export async function buildExampleSpec(assetsDir: string): Promise<BuildSpec> {
  const sceneNames = Array.from({ length: SCENE_COUNT }, (_, i) => `scene-${i + 1}`)
  const sceneDurations = await Promise.all(
    sceneNames.map(async (name) => (await probeMedia(join(assetsDir, `${name}.mp4`))).durationSec)
  )
  const audioDurationSec = (await probeMedia(join(assetsDir, 'audio.mp3'))).durationSec
  const totalVideoDurationSec = sceneDurations.reduce((sum, d) => sum + d, 0)

  const assets: Record<string, string> = {
    logo: './logo-single.png',
    audio: './audio.mp3',
  }
  const clips: BuildSpec['clips'] = []

  let cursor = 0
  sceneNames.forEach((name, i) => {
    assets[name] = `./${name}.mp4`
    clips.push({ track: 'video', asset: name, start: cursor })
    cursor += sceneDurations[i]
  })

  clips.push({
    track: 'text',
    text: 'Elah CLI Demo',
    start: 0,
    duration: 2,
    fontSize: 96,
    color: '#ffffff',
    fontWeight: 'bold',
    align: 'center',
    x: 0.5,
    y: 0.15,
  })

  clips.push({
    track: 'image',
    asset: 'logo',
    start: 0,
    duration: totalVideoDurationSec,
    x: 0.9,
    y: 0.9,
    scale: 0.15,
    opacity: 0.85,
  })

  clips.push({
    track: 'audio',
    asset: 'audio',
    start: 0,
    duration: Math.min(audioDurationSec, totalVideoDurationSec),
    volume: 0.5,
  })

  return { fps: 30, stage: { width: 1920, height: 1080 }, assets, clips }
}
