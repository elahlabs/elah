import { afterEach, describe, expect, it } from 'vitest'
import { clipLoadStore } from '../../../stores/clipLoad.store'
import { PENDING_MAX_AGE_MS, forget, forgetAll, hasPending, noteDrawn, noteUploaded, pendingAt } from './videoUploadProbe'

afterEach(() => {
  forgetAll()
  clipLoadStore.getState().clear()
})

describe('videoUploadProbe', () => {
  it('reports a clip drawn at a frame with no upload, until the upload lands', () => {
    noteDrawn('c1', 10, 0)
    expect(pendingAt(10, 1)).toEqual(['c1'])
    expect(hasPending(1)).toBe(true)
    noteUploaded('c1', 10)
    expect(pendingAt(10, 2)).toEqual([])
    expect(hasPending(2)).toBe(false)
  })

  it('a new frame makes an uploaded clip pending again (the stale-texture case)', () => {
    noteDrawn('c1', 10, 0)
    noteUploaded('c1', 10)
    noteDrawn('c1', 50, 100)
    expect(pendingAt(50, 101)).toEqual(['c1'])
    expect(pendingAt(10, 101)).toEqual([])
  })

  it('stops counting a miss older than 5 s', () => {
    noteDrawn('c1', 10, 0)
    expect(pendingAt(10, PENDING_MAX_AGE_MS)).toEqual(['c1'])
    expect(pendingAt(10, PENDING_MAX_AGE_MS + 1)).toEqual([])
    expect(hasPending(PENDING_MAX_AGE_MS + 1)).toBe(false)
  })

  it('redrawing the same frame does not restart the 5 s clock', () => {
    noteDrawn('c1', 10, 0)
    noteDrawn('c1', 10, 4000)
    expect(pendingAt(10, 5001)).toEqual([])
  })

  it('ignores a clip whose load state is error', () => {
    noteDrawn('c1', 10, 0)
    clipLoadStore.getState().set('c1', 'error')
    expect(pendingAt(10, 1)).toEqual([])
    expect(hasPending(1)).toBe(false)
  })

  it('forget removes the clip', () => {
    noteDrawn('c1', 10, 0)
    forget('c1')
    expect(pendingAt(10, 1)).toEqual([])
  })

  it('lists only clips drawn at the asked frame', () => {
    noteDrawn('a', 5, 0)
    noteDrawn('b', 6, 0)
    expect(pendingAt(5, 1)).toEqual(['a'])
  })
})
