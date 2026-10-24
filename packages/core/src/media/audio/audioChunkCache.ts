/**
 * Bounded LRU of decoded audio chunks for one source (LM-P5).
 *
 * Streaming preview decodes a source in fixed windows (`STREAM_CHUNK_SEC`) and
 * keeps only the most recently used few, so a two-hour file costs the same
 * memory as a one-minute one. A chunk a playing node is still reading stays
 * alive through that node's own reference; eviction only forgets the cache's.
 */

/** Seconds of source audio per decoded chunk. */
export const STREAM_CHUNK_SEC = 20
/** Chunks kept per source: the playing one, the prefetched ones, and slack for a seek back. */
export const MAX_STREAM_CHUNKS_PER_SOURCE = 6

export class AudioChunkCache<T> {
  private readonly entries = new Map<number, Promise<T>>()

  constructor(readonly maxChunks: number = MAX_STREAM_CHUNKS_PER_SOURCE) {}

  get size(): number {
    return this.entries.size
  }

  keys(): number[] {
    return [...this.entries.keys()]
  }

  /** The chunk `index`, loading it once; a hit becomes the most recently used. A failed load is forgotten. */
  get(index: number, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(index)
    if (hit) {
      this.entries.delete(index)
      this.entries.set(index, hit)
      return hit
    }
    const promise = load()
    this.entries.set(index, promise)
    promise.catch(() => {
      if (this.entries.get(index) === promise) this.entries.delete(index)
    })
    while (this.entries.size > this.maxChunks) {
      const oldest = this.entries.keys().next().value as number
      this.entries.delete(oldest)
    }
    return promise
  }

  clear(): void {
    this.entries.clear()
  }
}
