/**
 * Every GPU effect implementation, keyed by registry kind.
 *
 * `__tests__/EffectShaders.test.ts` asserts this map and
 * `effects/registry.ts` list exactly the same kinds.
 */

import { chromaticAberration } from './chromaticAberration'
import { colorGrade } from './colorGrade'
import { gaussianBlur } from './gaussianBlur'
import { grain } from './grain'
import { letterbox } from './letterbox'
import { rgbSplit } from './rgbSplit'
import { scanlines } from './scanlines'
import type { GpuEffect } from './types'
import { vignette } from './vignette'
import { bloom, flash, glow, lightRays, strobe } from './light'
import { bulge, displace, fisheye, twirl, wave } from './distortion'
import { crt, glitchBlocks, pixelate, vhs } from './glitch'
import { motionBlur } from './motionBlur'

export const GPU_EFFECTS: ReadonlyMap<string, GpuEffect> = new Map(
  [
    colorGrade,
    gaussianBlur,
    vignette,
    grain,
    rgbSplit,
    letterbox,
    chromaticAberration,
    scanlines,
    bloom,
    glow,
    flash,
    strobe,
    lightRays,
    wave,
    twirl,
    bulge,
    fisheye,
    displace,
    vhs,
    crt,
    pixelate,
    glitchBlocks,
    motionBlur,
  ].map(
    (e) => [e.kind, e],
  ),
)

export type { EffectEnv, GpuEffect, UniformValue } from './types'
