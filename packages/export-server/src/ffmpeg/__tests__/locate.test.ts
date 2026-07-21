import { describe, expect, it } from 'vitest'

import { MIN_FFMPEG_VERSION, parseEncoders, parseFfmpegVersion } from '../locate'

// Real `ffmpeg -hide_banner -encoders` output (macOS Homebrew build, ffmpeg
// 8.1.2), trimmed to a representative excerpt: the header/legend lines that
// must NOT be picked up as encoders, plus a handful of real encoder lines
// covering every flag-character shape (`.` vs a letter) these functions need
// to tolerate.
const ENCODERS_EXCERPT = `Encoders:
 V..... = Video
 A..... = Audio
 S..... = Subtitle
 .F.... = Frame-level multithreading
 ..S... = Slice-level multithreading
 ...X.. = Codec is experimental
 ....B. = Supports draw_horiz_band
 .....D = Supports direct rendering method 1
 ------
 V....D a64multi             Multicolor charset for Commodore 64 (codec a64_multi)
 V..X.D avui                 Avid Meridien Uncompressed
 VFS..D dnxhd                VC3/DNxHD
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D libx264rgb           libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 RGB (codec h264)
 V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)
 V..... libsvtav1            SVT-AV1(Scalable Video Technology for AV1) encoder (codec av1)
 A....D aac                  AAC (Advanced Audio Coding)
 A..... aac_at               aac (AudioToolbox) (codec aac)
 A....D mp3                  libmp3lame variant unused here, just a name shape
`

describe('parseFfmpegVersion', () => {
  it('parses a standard numbered release', () => {
    const stdout = 'ffmpeg version 8.1.2 Copyright (c) 2000-2026 the FFmpeg developers\nbuilt with Apple clang...'
    expect(parseFfmpegVersion(stdout)).toEqual([8, 1])
  })

  it('parses an older release below the version floor', () => {
    const stdout = 'ffmpeg version 4.4.1-0ubuntu0.22.04.1 Copyright (c) 2000-2021 the FFmpeg developers'
    expect(parseFfmpegVersion(stdout)).toEqual([4, 4])
  })

  it('tolerates a leading "n" from static-build version strings', () => {
    const stdout = 'ffmpeg version n6.1.1 Copyright (c) 2000-2023 the FFmpeg developers'
    expect(parseFfmpegVersion(stdout)).toEqual([6, 1])
  })

  it('exactly matches the version floor', () => {
    const stdout = 'ffmpeg version 5.1 Copyright (c) 2000-2022 the FFmpeg developers'
    expect(parseFfmpegVersion(stdout)).toEqual(MIN_FFMPEG_VERSION as [number, number])
  })

  it('returns null for a git/nightly build with no numeric version', () => {
    const stdout = 'ffmpeg version N-118234-g0abcdef1234 Copyright (c) 2000-2026 the FFmpeg developers'
    expect(parseFfmpegVersion(stdout)).toBeNull()
  })

  it('returns null for empty stdout', () => {
    expect(parseFfmpegVersion('')).toBeNull()
  })

  it('only inspects the first line', () => {
    const stdout = 'ffmpeg version N-118234-g0abcdef Copyright...\nversion 9.9 hidden further down should not count'
    expect(parseFfmpegVersion(stdout)).toBeNull()
  })
})

describe('parseEncoders', () => {
  it('extracts real encoder names and ignores the header/legend', () => {
    const encoders = parseEncoders(ENCODERS_EXCERPT)
    expect(encoders.has('Encoders:')).toBe(false)
    expect(encoders.has('Video')).toBe(false)
    expect(encoders.has('------')).toBe(false)
  })

  it('picks up H.264-capable encoders by name', () => {
    const encoders = parseEncoders(ENCODERS_EXCERPT)
    expect(encoders.has('libx264')).toBe(true)
    expect(encoders.has('libx264rgb')).toBe(true)
    expect(encoders.has('h264_videotoolbox')).toBe(true)
  })

  it('picks up an audio encoder', () => {
    const encoders = parseEncoders(ENCODERS_EXCERPT)
    expect(encoders.has('aac')).toBe(true)
    expect(encoders.has('aac_at')).toBe(true)
  })

  it('does not pick up an encoder ffmpeg does not report', () => {
    const encoders = parseEncoders(ENCODERS_EXCERPT)
    expect(encoders.has('h264_nvenc')).toBe(false)
  })

  it('returns an empty set for empty stdout', () => {
    expect(parseEncoders('').size).toBe(0)
  })

  it('handles a flag column with an experimental marker', () => {
    const encoders = parseEncoders(ENCODERS_EXCERPT)
    expect(encoders.has('avui')).toBe(true)
  })
})
