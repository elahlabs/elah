/**
 * analyzeAudioStream - beat/onset/silence analysis of a Blob's audio without
 * decoding it whole (LM-P5).
 *
 * The file is read in `chunkSec` slices, each downmixed to mono at `sampleRate`
 * and pushed into a `PcmAnalyzer`; only the analyser's per-hop accumulators
 * (about 100 doubles per second of audio) are kept, so a two-hour recording
 * needs tens of MB, not the ~600 MB of one mono Float32 array. The result is
 * identical to `analyzePcm` over the same PCM.
 */

import { openAudioStream, type AudioStream, type OpenAudioStreamOptions } from '../media/audio/streamDecode'
import { PcmAnalyzer, type AudioAnalysis, type AudioAnalysisOptions } from './analysis'

export interface AnalyzeAudioStreamOptions extends OpenAudioStreamOptions {
  /** Analysis rate. Default 22 050 (enough for the 6 kHz band). */
  sampleRate?: number
  /** Seconds decoded per step. Default 60. */
  chunkSec?: number
  analysis?: AudioAnalysisOptions
  stream?: AudioStream
  signal?: AbortSignal
  /** 0..1 after each chunk. */
  onProgress?: (fraction: number) => void
}

export async function analyzeAudioStream(
  source: Blob | string,
  fps: number,
  opts: AnalyzeAudioStreamOptions = {},
): Promise<AudioAnalysis> {
  const sampleRate = opts.sampleRate ?? 22_050
  const chunkSec = opts.chunkSec ?? 60
  const stream = opts.stream ?? (await openAudioStream(source, opts))
  try {
    const analyzer = new PcmAnalyzer(sampleRate, fps, opts.analysis)
    const duration = stream.durationSec
    for (let t = 0; t < duration; t += chunkSec) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const end = Math.min(duration, t + chunkSec)
      const { channels } = await stream.readRange(t, end, { mono: true, targetSampleRate: sampleRate })
      analyzer.push(channels[0]!)
      opts.onProgress?.(end / duration)
    }
    return analyzer.finish()
  } finally {
    if (!opts.stream) stream.close()
  }
}
