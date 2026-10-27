/**
 * The denoiser's names and sizes, apart from its worklet source (CONV-8).
 * `enhanceChain.ts` needs only these; keeping them out of `denoiseWorklet.ts`
 * lets the 5 KiB worklet source load with the Enhance feature instead of with
 * every editor.
 */

export const DENOISE_PROCESSOR_NAME = 'elah-denoise'
export const DENOISE_FRAME = 512
export const DENOISE_HOP = 128
/** Samples by which the denoiser's output trails its input. */
export const DENOISE_LATENCY_SAMPLES = DENOISE_FRAME - DENOISE_HOP
