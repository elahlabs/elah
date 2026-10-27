/**
 * The Enhance audio feature as one loadable module (CONV-8): the denoise
 * worklet and its loader. `renderer/gpu/features.ts` imports this file
 * dynamically, so a project with no Enhance clip never downloads it. The chain
 * builder (`enhanceChain.ts`, under 1 KiB) stays in the startup graph.
 */

export { ensureDenoiseWorklet } from './denoiseWorklet'
