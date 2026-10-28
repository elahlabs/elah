/**
 * GPU effect contract (EDX-P2).
 *
 * Every kind in `effects/registry.ts` has exactly one `GpuEffect` here. An
 * effect is a fragment shader plus a PURE function from resolved params to
 * uniform values, so the maths that turns "radius 12 px" into shader numbers
 * is unit-testable without a GL context.
 *
 * Coordinate conventions the chain guarantees to every effect:
 *  - `vUv` spans the whole chain target (0..1, GL orientation, y up).
 *  - The clip's own content sits in `uInner` (x, y, w, h in uv); the rest is
 *    transparent padding the chain allocated so blurs and splits can bleed.
 *  - Colour is PREMULTIPLIED alpha in and out.
 */

import type { EffectParamValue } from '../../../effects/registry'

/** Everything about the current chain target an effect may need. */
export interface EffectEnv {
  /** 0-based pass index, for effects with more than one pass. */
  pass: number
  /** Chain target size in pixels. */
  size: readonly [number, number]
  /** The clip's content box inside the target, in uv (x, y, w, h). */
  inner: readonly [number, number, number, number]
  /** Chain pixels per stage pixel, per axis. Stage-px params multiply by this. */
  pxPerStagePx: readonly [number, number]
  /** Timeline frame and seconds (frame / fps). */
  frame: number
  time: number
}

/** A uniform value: a float, or a vec2/vec3/vec4 as a tuple. */
export type UniformValue = number | readonly number[]

export type EffectParams = Readonly<Record<string, EffectParamValue>>

export interface GpuEffect {
  kind: string
  /** Complete fragment shader source (header included). */
  frag: string
  /** Full-target draws per frame. */
  passes(params: EffectParams): number
  /**
   * Stage pixels the effect may bleed beyond the clip's box. The chain pads
   * the target by the sum over the stack (capped). Omitted = 0.
   */
  padding?(params: EffectParams, box: { width: number; height: number }): number
  /**
   * True when, for these resolved params and this clip box (stage px), the
   * effect would change nothing this frame (MI-P8). The chain then leaves it
   * out entirely: no pass, no padding, no shader compile. Omitted = never
   * skipped, so every effect that predates this hook runs exactly as before.
   */
  skip?(params: EffectParams, box: { width: number; height: number }): boolean
  /** Uniforms for one pass, by name. Must be pure. */
  uniforms(params: EffectParams, env: EffectEnv): Record<string, UniformValue>
}

/** `#rrggbb` → linear-ish 0..1 RGB (sRGB values, no conversion). */
export function hexToRgb(hex: EffectParamValue | undefined): [number, number, number] {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return [0, 0, 0]
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** A numeric param, or `fallback` when missing / not a number. */
export function num(params: EffectParams, name: string, fallback = 0): number {
  const v = params[name]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** Box aspect ratio (width / height) in chain pixels. */
export function boxAspect(env: EffectEnv): number {
  const w = env.inner[2] * env.size[0]
  const h = env.inner[3] * env.size[1]
  return h > 0 ? w / h : 1
}

/**
 * Shared GLSL header. `uTex` is the previous pass, `uTexel` = 1 / size,
 * `uInner` = content box in uv, `uTime` = seconds.
 */
export const EFFECT_FRAG_HEADER = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uTexel;
uniform vec4 uInner;
uniform float uTime;

in vec2 vUv;
out vec4 fragColor;

// uv -> 0..1 inside the clip's own box (the chain pads around it).
vec2 boxUv(vec2 uv) { return (uv - uInner.xy) / uInner.zw; }

float inBox(vec2 uv) {
  vec2 b = boxUv(uv);
  return step(0.0, b.x) * step(b.x, 1.0) * step(0.0, b.y) * step(b.y, 1.0);
}

vec3 unpremul(vec4 c) { return c.a > 0.0 ? c.rgb / c.a : vec3(0.0); }
`
