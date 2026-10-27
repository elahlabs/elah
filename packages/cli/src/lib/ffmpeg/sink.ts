import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CliError } from '../errors'
import type { Container } from '../format'
import type { AudioMixMeta, EncodeSink } from '../server'
import { interleaveF32, PngFrameEncoder, type EncoderAudioInput } from './encoder'
import type { FfmpegBinary } from './locate'

export interface FfmpegSinkInit {
  ffmpeg: FfmpegBinary
  container: Container
  videoEncoder: string
  audioEncoder: string
  fps: number
  videoBitrate: number
  audioBitrate: number
}

export interface FfmpegEncodeSink extends EncodeSink {
  /** Kill ffmpeg if still running and delete the scratch directory. Always call it. */
  dispose(): Promise<void>
}

/**
 * The harness server's EncodeSink for one render: holds the audio mix in a
 * scratch file, starts ffmpeg on the first frame (so the audio, which the page
 * sends first, is muxed in the same pass), and reads the finished file back.
 */
export async function createFfmpegEncodeSink(init: FfmpegSinkInit): Promise<FfmpegEncodeSink> {
  const workDir = await mkdtemp(join(tmpdir(), 'elah-export-'))
  const outPath = join(workDir, `out.${init.container}`)
  let audio: EncoderAudioInput | null = null
  let encoder: PngFrameEncoder | undefined

  return {
    async audio(meta: AudioMixMeta, planarPcm: Buffer): Promise<void> {
      if (encoder) throw new CliError('Audio mix arrived after the first frame; ffmpeg has already started')
      const bytesPerChannel = meta.length * 4
      const channels = Array.from({ length: meta.channels }, (_, c) => {
        // Copy out: the request body need not be 4-byte aligned for a Float32Array view.
        const samples = new Float32Array(meta.length)
        Buffer.from(samples.buffer).set(planarPcm.subarray(c * bytesPerChannel, (c + 1) * bytesPerChannel))
        return samples
      })
      const path = join(workDir, 'audio.f32')
      await writeFile(path, interleaveF32(channels, meta.length))
      audio = { path, sampleRate: meta.sampleRate, channels: meta.channels, bitrate: init.audioBitrate }
    },

    async frame(png: Buffer): Promise<void> {
      encoder ??= PngFrameEncoder.start({
        ffmpeg: init.ffmpeg,
        outPath,
        container: init.container,
        fps: init.fps,
        videoEncoder: init.videoEncoder,
        audioEncoder: init.audioEncoder,
        videoBitrate: init.videoBitrate,
        audio,
      })
      await encoder.writeFrame(png)
    },

    async finish(): Promise<Buffer> {
      if (!encoder) throw new CliError('The browser finished the export without producing a frame')
      await encoder.finish()
      return readFile(outPath)
    },

    async dispose(): Promise<void> {
      await encoder?.abort()
      await rm(workDir, { recursive: true, force: true })
    },
  }
}
