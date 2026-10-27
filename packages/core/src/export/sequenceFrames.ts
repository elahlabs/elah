/**
 * SequenceFrameStore — export-side frame cache for sequence clips (PV-P8c).
 *
 * `SequenceReader.ts` and `SequenceFrameProvider.ts` (PV-P8b) are async and
 * DOM-free by design so this worker can reuse them. This module is the export
 * worker's own bookkeeping on top of the reader: readers are shared by
 * `sequenceSourceKey` (two clips of one GIF open it once), and the decoded
 * image for each *occurrence* (top-level clip id, or a compound child's
 * occurrence key) is held until its index changes or it stops being active.
 *
 * `SequenceFrameProvider` is not reused here: it is built for a synchronous
 * `getCurrent`/asynchronous `requestFrame` split that suits a renderer polling
 * every frame, prefetching ahead of the playhead. The export worker instead
 * awaits exactly the frame each output frame needs, once, before painting it
 * — a strictly simpler contract with no prefetch and no "miss" state.
 *
 * DOM-free: no `document`/`window` reference. `dispose()` must be called once
 * per export or the store leaks every reader and cached image it opened.
 */

import type { ActiveSequenceClip } from '../resolver/scene'
import { sequenceSourceKey } from '../resolver/sequence'
import type { SequenceFallback, SequenceFrameReader, SequenceImage } from '../media/sequence/SequenceReader'

export interface SequenceFrameStore {
  /**
   * The image for `item.frameIndex` held under `key`, decoding it only when
   * the index changed. Null when the source failed to open or the frame
   * failed to decode.
   */
  frameFor(key: string, item: ActiveSequenceClip): Promise<SequenceImage | null>
  /**
   * Close images held under keys not in `activeKeys`. Call once per exported
   * frame, after painting.
   */
  retain(activeKeys: ReadonlySet<string>): void
  /** Close every held image and every reader. */
  dispose(): void
}

interface ReaderEntry {
  /** Settles once, the first time this source is opened; never re-created. */
  promise: Promise<SequenceFrameReader> | null
  reader: SequenceFrameReader | null
  /** A rejected open is cached — no retry within one export. */
  failed: boolean
  /** `onFallback` fires once per source, not once per occurrence/frame. */
  fallbackReported: boolean
}

interface HeldImage {
  index: number
  image: SequenceImage
}

export function createSequenceFrameStore(deps: {
  /** Open the reader for an item's source (called once per `sequenceSourceKey`). */
  open(item: ActiveSequenceClip): Promise<SequenceFrameReader>
  /** Once per source whose reader reports a fallback. */
  onFallback?(item: ActiveSequenceClip, reason: SequenceFallback): void
  /** Once per source whose open rejects, or per failed frame. */
  onError?(item: ActiveSequenceClip, message: string): void
}): SequenceFrameStore {
  const readers = new Map<string, ReaderEntry>()
  const held = new Map<string, HeldImage>()

  function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  /** The reader for `item`'s source, opening it exactly once. Null if the open failed. */
  async function readerFor(item: ActiveSequenceClip): Promise<SequenceFrameReader | null> {
    const sourceKey = sequenceSourceKey(item)
    let entry = readers.get(sourceKey)
    if (!entry) {
      entry = { promise: null, reader: null, failed: false, fallbackReported: false }
      readers.set(sourceKey, entry)
    }
    if (entry.failed) return null
    if (entry.reader) return entry.reader

    if (!entry.promise) {
      const e = entry
      e.promise = deps.open(item).then(
        (reader) => {
          e.reader = reader
          if (reader.fallback && !e.fallbackReported) {
            e.fallbackReported = true
            deps.onFallback?.(item, reader.fallback)
          }
          return reader
        },
        (err) => {
          e.failed = true
          deps.onError?.(item, errorMessage(err))
          throw err
        },
      )
    }

    try {
      return await entry.promise
    } catch {
      return null
    }
  }

  return {
    async frameFor(key, item) {
      const reader = await readerFor(item)
      if (!reader) return null
      const index = Math.min(Math.max(0, item.frameIndex), reader.frameCount - 1)

      const prev = held.get(key)
      if (prev && prev.index === index) return prev.image

      let image: SequenceImage
      try {
        image = await reader.read(index)
      } catch (err) {
        deps.onError?.(item, errorMessage(err))
        return null
      }

      if (prev) prev.image.close()
      held.set(key, { index, image })
      return image
    },

    retain(activeKeys) {
      for (const [key, entry] of held) {
        if (activeKeys.has(key)) continue
        entry.image.close()
        held.delete(key)
      }
    },

    dispose() {
      for (const entry of held.values()) entry.image.close()
      held.clear()
      for (const entry of readers.values()) entry.reader?.close()
      readers.clear()
    },
  }
}
