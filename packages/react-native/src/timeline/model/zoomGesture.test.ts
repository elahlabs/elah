import { describe, expect, it } from 'vitest'
import { computeAnchoredScrollLeft, ZOOM_MAX, ZOOM_MIN } from '@elah/core'
import {
  anchoredZoom,
  beginPinch,
  fitToWindowZoom,
  pinchPreviewTransform,
  updatePinch,
  zoomAtPlayhead,
} from './zoomGesture'

describe('pinchPreviewTransform', () => {
  it('is the identity when the preview equals the starting state', () => {
    const s = beginPinch(4, 100, 50)
    expect(pinchPreviewTransform(s, updatePinch(s, 1))).toEqual({ scale: 1, tx: 0 })
  })

  it('maps a 2x pinch onto the previewed scroll offset', () => {
    const s = beginPinch(4, 100, 50)
    const preview = updatePinch(s, 2)
    expect(preview.scrollX).toBe(250)
    expect(pinchPreviewTransform(s, preview)).toEqual({ scale: 2, tx: -150 })
  })

  it('keeps the anchor frame under the midpoint', () => {
    const s = beginPinch(4, 100, 50)
    const { scale, tx } = pinchPreviewTransform(s, updatePinch(s, 2))
    // Frame 37.5 (under x = 50 at the start) is laid out at 37.5 * 4 at zoom 4, then scaled and shifted.
    expect(37.5 * 4 * scale + tx - s.startScrollX).toBeCloseTo(50, 10)
  })
})

describe('pinch', () => {
  it('scales the starting zoom and keeps the frame under the fingers still', () => {
    const session = beginPinch(4, 100, 50)
    const preview = updatePinch(session, 2)
    expect(preview.zoom).toBe(8)
    // Frame under the midpoint: (100 + 50) / 4 = 37.5; at zoom 8 it sits at 300, so scroll = 250.
    expect(preview.scrollX).toBe(250)
    expect(preview.scrollX).toBe(computeAnchoredScrollLeft(4, 8, 100, 50))
  })

  it('always measures from the start of the pinch, so there is no drift between updates', () => {
    const session = beginPinch(4, 100, 50)
    updatePinch(session, 1.5)
    updatePinch(session, 1.9)
    expect(updatePinch(session, 2)).toEqual({ zoom: 8, scrollX: 250 })
  })

  it('lets the content follow the fingers when the midpoint moves', () => {
    const session = beginPinch(4, 100, 50)
    // Same frame (37.5) must now sit under x = 70.
    expect(updatePinch(session, 2, 70).scrollX).toBe(230)
  })

  it('clamps the zoom and never scrolls negative', () => {
    expect(updatePinch(beginPinch(4, 0, 0), 1000).zoom).toBe(ZOOM_MAX)
    const out = updatePinch(beginPinch(4, 5, 2), 0.0001)
    expect(out.zoom).toBe(ZOOM_MIN)
    expect(out.scrollX).toBeGreaterThanOrEqual(0)
  })

  it('ignores a degenerate scale', () => {
    expect(updatePinch(beginPinch(4, 100, 50), 0)).toEqual({ zoom: 4, scrollX: 100 })
  })
})

describe('anchoredZoom / zoomAtPlayhead', () => {
  it('anchors a discrete step at the given x', () => {
    expect(anchoredZoom(1, 100, 50, 2)).toEqual({ zoom: 2, scrollX: 250 })
  })

  it('clamps the requested zoom before anchoring', () => {
    const out = anchoredZoom(4, 0, 0, 1e6)
    expect(out.zoom).toBe(ZOOM_MAX)
  })

  it('anchors on the playhead when it is in view', () => {
    // playhead at frame 50, zoom 2, scroll 20 -> on-screen x 80.
    const out = zoomAtPlayhead(2, 20, 50, 400, 4)
    expect(out.zoom).toBe(4)
    expect(out.scrollX).toBe(computeAnchoredScrollLeft(2, 4, 20, 80))
  })

  it('anchors on the viewport centre when the playhead is off-screen', () => {
    const out = zoomAtPlayhead(2, 0, 1000, 400, 4)
    expect(out.scrollX).toBe(computeAnchoredScrollLeft(2, 4, 0, 200))
  })
})

describe('fitToWindowZoom', () => {
  it('fits the whole timeline into the lane width', () => {
    expect(fitToWindowZoom(600, 1200, 30)).toBe(0.5)
  })

  it('uses a 10-second baseline for an empty timeline', () => {
    expect(fitToWindowZoom(600, 0, 30)).toBe(2)
  })

  it('clamps to the zoom range', () => {
    expect(fitToWindowZoom(1, 1_000_000, 30)).toBe(ZOOM_MIN)
    expect(fitToWindowZoom(100_000, 10, 30)).toBe(ZOOM_MAX)
  })
})
