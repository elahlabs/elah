import type { ChildProcess } from 'node:child_process'

const DEFAULT_STDERR_TAIL_BYTES = 8192

/**
 * Keep only the last `maxBytes` of a child's stderr as a rolling buffer, so a
 * long-lived ffmpeg process can still report a useful error on failure
 * without holding its whole stderr history in memory.
 *
 * Ported from task-engine's media-export engine (ffmpeg/spawn.ts).
 */
export function attachStderrTail(child: ChildProcess, maxBytes: number = DEFAULT_STDERR_TAIL_BYTES): () => string {
  let tail = Buffer.alloc(0)
  child.stderr?.on('data', (chunk: Buffer) => {
    tail = Buffer.concat([tail, chunk])
    if (tail.length > maxBytes) {
      tail = Buffer.from(tail.subarray(tail.length - maxBytes))
    }
  })
  return () => tail.toString('utf8')
}
