/**
 * Which video clips were drawn at a timeline frame without a decoded picture
 * to upload.
 *
 * `VideoLayer.draw` keeps the previous texture on a cache miss and reports
 * nothing, so a re-seek paints the OLD frame until the decode lands. This plain
 * module (no store, no notifications per frame) lets a reader ask "is anything
 * drawn at frame N still waiting for its decode?". Frame capture waits on it,
 * and the preview keeps redrawing while it is non-empty.
 *
 * A miss older than `PENDING_MAX_AGE_MS`, or a clip whose container failed to
 * open, stops counting so a dead clip never keeps the preview redrawing.
 */

import { clipLoadStore } from '../../../stores/clipLoad.store'

/** A miss older than this no longer counts as pending. */
export const PENDING_MAX_AGE_MS = 5000

interface Entry {
  drawnFrame: number
  uploadedFrame: number
  /** When the clip was first drawn at `drawnFrame`. */
  since: number
}

const entries = new Map<string, Entry>()

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** The clip was drawn at this timeline frame. Call before the upload attempt. */
export function noteDrawn(clipId: string, timelineFrame: number, now: number = nowMs()): void {
  const e = entries.get(clipId)
  if (!e) {
    entries.set(clipId, { drawnFrame: timelineFrame, uploadedFrame: Number.NaN, since: now })
    return
  }
  if (e.drawnFrame !== timelineFrame) {
    e.drawnFrame = timelineFrame
    e.since = now
  }
}

/** A texture upload for this clip succeeded while drawing this timeline frame. */
export function noteUploaded(clipId: string, timelineFrame: number): void {
  const e = entries.get(clipId)
  if (!e) {
    entries.set(clipId, { drawnFrame: timelineFrame, uploadedFrame: timelineFrame, since: nowMs() })
    return
  }
  e.uploadedFrame = timelineFrame
}

export function forget(clipId: string): void {
  entries.delete(clipId)
}

/** Test and teardown helper: drop everything. */
export function forgetAll(): void {
  entries.clear()
}

function isPending(clipId: string, e: Entry, now: number): boolean {
  if (e.uploadedFrame === e.drawnFrame) return false
  if (now - e.since > PENDING_MAX_AGE_MS) return false
  if (clipLoadStore.getState().byClipId[clipId] === 'error') return false
  return true
}

/** Clips drawn at `timelineFrame` that have no upload for that frame yet. */
export function pendingAt(timelineFrame: number, now: number = nowMs()): string[] {
  const out: string[] = []
  for (const [id, e] of entries) {
    if (e.drawnFrame === timelineFrame && isPending(id, e, now)) out.push(id)
  }
  return out
}

/** Whether any clip's latest draw is still waiting for its picture. */
export function hasPending(now: number = nowMs()): boolean {
  for (const [id, e] of entries) if (isPending(id, e, now)) return true
  return false
}

export const videoUploadProbe = { noteDrawn, noteUploaded, forget, forgetAll, pendingAt, hasPending }
