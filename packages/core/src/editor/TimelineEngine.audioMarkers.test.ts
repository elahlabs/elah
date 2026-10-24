import { beforeEach, describe, expect, it } from 'vitest'
import { TimelineEngine } from './TimelineEngine'
import type { AudioMarkerSet } from '../types'

/** PV-P10b: setAudioMarkers / removeAudioMarkers. */

describe('audio markers', () => {
  let engine: TimelineEngine
  beforeEach(() => {
    engine = new TimelineEngine({ fps: 30 })
  })

  const setFor = (src: string, beats: number[]): AudioMarkerSet => ({
    src,
    fps: 30,
    version: 1,
    beats,
    silences: [],
  })

  it('adds a set as one undo step named "Detect beats"', () => {
    engine.setAudioMarkers(setFor('song', [0, 30]))
    expect(engine.getProject().audioMarkers).toEqual([setFor('song', [0, 30])])
    expect(engine.lastHistoryDescription()).toBe('Detect beats')
  })

  it('a second call with the same src replaces it (length stays 1)', () => {
    engine.setAudioMarkers(setFor('song', [0, 30]))
    engine.setAudioMarkers(setFor('song', [10, 40]))
    expect(engine.getProject().audioMarkers).toHaveLength(1)
    expect(engine.getProject().audioMarkers).toEqual([setFor('song', [10, 40])])
  })

  it('undo restores the first set', () => {
    engine.setAudioMarkers(setFor('song', [0, 30]))
    engine.setAudioMarkers(setFor('song', [10, 40]))
    engine.undo()
    expect(engine.getProject().audioMarkers).toEqual([setFor('song', [0, 30])])
  })

  it('removeAudioMarkers removes the set, deletes the key, one undo step named "Clear beats"', () => {
    engine.setAudioMarkers(setFor('song', [0, 30]))
    engine.removeAudioMarkers('song')
    expect('audioMarkers' in engine.getProject()).toBe(false)
    expect(engine.lastHistoryDescription()).toBe('Clear beats')
  })

  it('removing an unknown src is a no-op: same project object, no undo entry', () => {
    engine.setAudioMarkers(setFor('song', [0, 30]))
    const before = engine.getProject()
    engine.removeAudioMarkers('nope')
    expect(engine.getProject()).toBe(before)
    // A single undo now unwinds the ADD, proving the no-op removal pushed no
    // entry of its own onto the stack.
    engine.undo()
    expect('audioMarkers' in engine.getProject()).toBe(false)
    expect(engine.canUndo()).toBe(false)
  })
})
