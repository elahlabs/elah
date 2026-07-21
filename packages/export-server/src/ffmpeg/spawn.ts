/**
 * Small child_process helpers shared by decoder.ts and encoder.ts so neither
 * reinvents stderr capture or exit handling. Nothing here knows about
 * frames, Scenes, or ffmpeg argv shape — it is pure process plumbing.
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

const DEFAULT_STDERR_TAIL_BYTES = 8192

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

/**
 * Runs ffmpeg to completion and buffers both streams. For `-version` /
 * `-encoders` only: it holds all of stdout in memory, which for a rawvideo
 * decode/encode pipe would be gigabytes. `timeoutMs`, when given, guards
 * against a hung probe (e.g. a misidentified binary waiting on stdin).
 */
export async function runFfmpeg(
  binary: string,
  args: string[],
  timeoutMs?: number
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args)
    let stdout = ''
    let stderr = ''
    let settled = false

    const timer =
      timeoutMs !== undefined
        ? setTimeout(() => {
            if (settled) return
            settled = true
            child.kill('SIGKILL')
            reject(new Error(`${binary} ${args.join(' ')} timed out after ${timeoutMs}ms`))
          }, timeoutMs)
        : undefined

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.once('error', (err) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.once('close', (code) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

/**
 * Keeps only the last `maxBytes` of stderr, as a rolling buffer, so a
 * long-lived decode/encode process can still report a useful error on
 * failure without holding its entire stderr history in memory.
 */
export function attachStderrTail(
  child: ChildProcess,
  maxBytes: number = DEFAULT_STDERR_TAIL_BYTES
): () => string {
  let tail = Buffer.alloc(0)
  child.stderr?.on('data', (chunk: Buffer) => {
    tail = Buffer.concat([tail, chunk])
    if (tail.length > maxBytes) {
      tail = Buffer.from(tail.subarray(tail.length - maxBytes))
    }
  })
  return () => tail.toString('utf8')
}

/**
 * Resolves with the exit code on 'close'; rejects on spawn 'error'. `once` on
 * both events avoids a double settle — Node emits 'close' after a spawn
 * error too in some failure modes, and after this resolves/rejects once we
 * no longer care.
 */
export function processExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once('error', (err) => reject(err))
    child.once('close', (code) => resolve(code))
  })
}

/**
 * SIGKILL + await close, tolerant of an already-dead process.
 *
 * SIGKILL is deliberate, not SIGTERM: an ffmpeg process blocked writing to a
 * full stdout pipe (the export loop stalled on backpressure, an abort mid
 * export) does not reliably act on SIGTERM, and teardown must not hang.
 *
 * Guards on `exitCode`/`signalCode` before awaiting `processExit` because
 * 'close' only ever fires once — if the process already exited, that event
 * already fired and a second `.once('close', ...)` registration would never
 * resolve.
 */
export async function killProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGKILL')
  try {
    await processExit(child)
  } catch {
    // Spawn never succeeded or 'error' fired on an already-dying process —
    // either way there is nothing left to tear down.
  }
}
