import { describe, it, expect } from 'vitest'
import { buildAudioMix, buildSegmentChain } from '../audio'
import type { AudioClipPlan } from '../../types'

const FPS = 30
const BASE_OPTIONS = { fps: FPS, totalFrames: 300, sampleRate: 48000, channels: 2 }

function segment(overrides: Partial<AudioClipPlan> = {}): AudioClipPlan {
  return {
    clipId: 'clip-1',
    source: '/media/a.mp3',
    startFrame: 0,
    frameCount: 300,
    sourceStartFrame: 0,
    volume: 1,
    ...overrides,
  }
}

describe('buildSegmentChain', () => {
  it('emits atrim/adelay/volume derived purely from frames', () => {
    const chain = buildSegmentChain(
      segment({ startFrame: 15, sourceStartFrame: 30, frameCount: 60, volume: 0.5 }),
      1,
      BASE_OPTIONS,
    )
    expect(chain).toBe(
      '[1:a]atrim=start=1:end=3,asetpts=PTS-STARTPTS,' +
        'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,' +
        'volume=0.5,adelay=500:all=1[a0]',
    )
  })

  it('derives the output label from inputIndex - 1', () => {
    const chain = buildSegmentChain(segment(), 3, BASE_OPTIONS)
    expect(chain.endsWith('[a2]')).toBe(true)
    expect(chain.startsWith('[3:a]')).toBe(true)
  })

  it('uses a mono channel layout when channels === 1', () => {
    const chain = buildSegmentChain(segment(), 1, { ...BASE_OPTIONS, channels: 1 })
    expect(chain).toContain('channel_layouts=mono')
  })

  it('multiplies segment volume by masterVolume', () => {
    const chain = buildSegmentChain(segment({ volume: 0.5 }), 1, { ...BASE_OPTIONS, masterVolume: 0.5 })
    expect(chain).toContain('volume=0.25')
  })

  it('defaults masterVolume to 1 when omitted', () => {
    const chain = buildSegmentChain(segment({ volume: 0.8 }), 1, BASE_OPTIONS)
    expect(chain).toContain('volume=0.8')
  })

  it('every emitted duration equals frame count divided by fps exactly', () => {
    for (const fps of [24, 25, 30, 50, 60]) {
      const s = segment({ sourceStartFrame: 7, frameCount: 41 })
      const chain = buildSegmentChain(s, 1, { ...BASE_OPTIONS, fps })
      const expectedIn = 7 / fps
      const expectedOut = (7 + 41) / fps
      expect(chain).toContain(`atrim=start=${expectedIn}:end=${expectedOut}`)
    }
  })
})

describe('buildAudioMix', () => {
  it('returns null for an empty segment list', () => {
    expect(buildAudioMix([], BASE_OPTIONS)).toBeNull()
  })

  it('returns null when every segment is muted', () => {
    expect(buildAudioMix([segment({ volume: 0 }), segment({ volume: 0, clipId: 'clip-2' })], BASE_OPTIONS)).toBeNull()
  })

  it('drops muted segments and keeps the rest', () => {
    const muted = segment({ clipId: 'muted', volume: 0 })
    const loud = segment({ clipId: 'loud', volume: 1 })
    const spec = buildAudioMix([muted, loud], BASE_OPTIONS)
    expect(spec).not.toBeNull()
    expect(spec!.inputs).toHaveLength(1)
    expect(spec!.inputs[0].clipId).toBe('loud')
    // single surviving segment: no amix stage, straight into the pad tail
    expect(spec!.filterComplex).not.toContain('amix')
    expect(spec!.filterComplex).toContain('[a0]apad=')
  })

  it('single segment: skips amix and feeds a0 straight into the pad stage', () => {
    const spec = buildAudioMix([segment()], BASE_OPTIONS)
    expect(spec).not.toBeNull()
    expect(spec!.filterComplex).toMatchInlineSnapshot(
      `"[1:a]atrim=start=0:end=10,asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=1,adelay=0:all=1[a0];[a0]apad=whole_dur=10,atrim=end=10,asetpts=N/SR/TB[aout]"`,
    )
  })

  it('two segments: amix with normalize=0 and both adelay:all=1 present', () => {
    const spec = buildAudioMix(
      [
        segment({ clipId: 'a', startFrame: 0 }),
        segment({ clipId: 'b', startFrame: 30, frameCount: 270 }),
      ],
      BASE_OPTIONS,
    )
    expect(spec).not.toBeNull()
    expect(spec!.filterComplex).toContain('normalize=0')
    expect(spec!.filterComplex).toContain('amix=inputs=2')
    expect((spec!.filterComplex.match(/:all=1/g) ?? []).length).toBe(2)
    expect(spec!.filterComplex).toMatchInlineSnapshot(
      `"[1:a]atrim=start=0:end=10,asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=1,adelay=0:all=1[a0];[2:a]atrim=start=0:end=9,asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=1,adelay=1000:all=1[a1];[a0][a1]amix=inputs=2:duration=longest:normalize=0[amix];[amix]apad=whole_dur=10,atrim=end=10,asetpts=N/SR/TB[aout]"`,
    )
  })

  it('three segments: amix with normalize=0, all inputs mapped in order', () => {
    const spec = buildAudioMix(
      [
        segment({ clipId: 'a' }),
        segment({ clipId: 'b' }),
        segment({ clipId: 'c' }),
      ],
      BASE_OPTIONS,
    )
    expect(spec).not.toBeNull()
    expect(spec!.inputs.map(i => i.clipId)).toEqual(['a', 'b', 'c'])
    expect(spec!.filterComplex).toContain('amix=inputs=3:duration=longest:normalize=0')
    expect((spec!.filterComplex.match(/:all=1/g) ?? []).length).toBe(3)
    expect(spec!.filterComplex.endsWith('[aout]')).toBe(true)
  })

  it('assigns ffmpeg input indices in appended order, starting at 1', () => {
    const spec = buildAudioMix([segment({ clipId: 'a' }), segment({ clipId: 'b' })], BASE_OPTIONS)
    expect(spec!.filterComplex).toContain('[1:a]')
    expect(spec!.filterComplex).toContain('[2:a]')
    expect(spec!.filterComplex).not.toContain('[3:a]')
  })

  it('pads/trims to totalFrames / fps exactly, not a rounded approximation', () => {
    const spec = buildAudioMix([segment()], { ...BASE_OPTIONS, fps: 24, totalFrames: 100 })
    const totalSec = 100 / 24
    expect(spec!.filterComplex).toContain(`apad=whole_dur=${totalSec}`)
    expect(spec!.filterComplex).toContain(`atrim=end=${totalSec}`)
  })

  it('carries sampleRate and channels through to the spec', () => {
    const spec = buildAudioMix([segment()], { ...BASE_OPTIONS, sampleRate: 44100, channels: 1 })
    expect(spec!.sampleRate).toBe(44100)
    expect(spec!.channels).toBe(1)
  })

  it('applies masterVolume to every segment in a multi-segment mix', () => {
    const spec = buildAudioMix(
      [segment({ clipId: 'a', volume: 0.4 }), segment({ clipId: 'b', volume: 0.6 })],
      { ...BASE_OPTIONS, masterVolume: 0.5 },
    )
    expect(spec!.filterComplex).toContain('volume=0.2')
    expect(spec!.filterComplex).toContain('volume=0.3')
  })
})
