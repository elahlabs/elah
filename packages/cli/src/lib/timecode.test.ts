import { describe, it, expect } from 'vitest'
import { parseFramePosition } from './timecode'
import { CliError } from './errors'

describe('parseFramePosition', () => {
  it('passes plain integers through', () => {
    expect(parseFramePosition('0', 30)).toBe(0)
    expect(parseFramePosition('42', 30)).toBe(42)
  })

  it('parses SS:FF', () => {
    expect(parseFramePosition('02:00', 30)).toBe(60)
    expect(parseFramePosition('01:15', 30)).toBe(45)
  })

  it('parses MM:SS:FF', () => {
    expect(parseFramePosition('00:02:00', 30)).toBe(60)
    expect(parseFramePosition('01:00:00', 30)).toBe(1800)
  })

  it('parses HH:MM:SS:FF (matching core framesToTimecode)', () => {
    expect(parseFramePosition('00:00:02:00', 30)).toBe(60)
    expect(parseFramePosition('01:00:00:00', 30)).toBe(108000)
  })

  it('rejects a frame part at or above fps', () => {
    expect(() => parseFramePosition('00:00:30', 30)).toThrow(CliError)
    expect(parseFramePosition('00:00:29', 30)).toBe(29)
  })

  it('rejects seconds/minutes >= 60', () => {
    expect(() => parseFramePosition('00:61:00', 30)).toThrow(CliError)
    expect(() => parseFramePosition('01:61:00:00', 30)).toThrow(CliError)
  })

  it('rejects malformed values with a usage error (exit 2)', () => {
    for (const bad of ['abc', '1:2:3:4:5', '-5', '1:x', '', ':', '10:']) {
      try {
        parseFramePosition(bad, 30)
        expect.unreachable(`expected '${bad}' to throw`)
      } catch (err) {
        expect(err).toBeInstanceOf(CliError)
        expect((err as CliError).exitCode).toBe(2)
      }
    }
  })
})
