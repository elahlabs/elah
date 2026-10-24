/**
 * The GPU half of masks, blends and mattes (EDX-P7), split out of
 * `compositing.ts` by CONV-8 so it loads with the effect chain instead of with
 * every editor. `compositing.ts` keeps what the layers need on every frame
 * (`needsChain`, `isDrawableMask`) and what the exporter composites with.
 */

import type { BlendMode, ClipMask } from '../../types'
import { MASK_KIND_INDEX } from './compositing'
import { EFFECT_FRAG_HEADER, type UniformValue } from './effects/types'

/**
 * The box a mask is measured in, when it is not the clip's whole box: a
 * text block or shape that is painted onto a full-stage canvas. Pixel rect
 * inside the chain's content box (top-left origin), rotated about its centre.
 */
export interface MaskFrame {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

export const MASK_FRAG = EFFECT_FRAG_HEADER + /* glsl */ `
uniform int uKind;          // 0 rect, 1 ellipse, 2 gradient, 3 path
uniform sampler2D uPath;    // rasterised path, covering the mask box
uniform vec2 uBoxPx;        // clip box size, chain px
uniform vec2 uCenter;       // mask centre, box px from top-left (y down)
uniform vec2 uHalf;         // mask half size, box px
uniform float uRotation;    // radians, clockwise on screen
uniform float uFeather;     // px
uniform float uAngle;       // gradient direction, radians
uniform float uInvert;      // 0 or 1

void main() {
  vec4 s = texture(uTex, vUv);
  vec2 b = boxUv(vUv);
  vec2 p = vec2(b.x, 1.0 - b.y) * uBoxPx - uCenter;
  float c = cos(uRotation), sn = sin(uRotation);
  vec2 q = vec2(c * p.x + sn * p.y, -sn * p.x + c * p.y);
  vec2 h = max(uHalf, vec2(0.0001));
  float a;
  if (uKind == 3) {
    // Mask-local, y down, 0..1 across the box; the raster was uploaded
    // flipped, so v = 1 is its top row.
    vec2 m = q / (2.0 * h) + 0.5;
    float inside = step(0.0, m.x) * step(m.x, 1.0) * step(0.0, m.y) * step(m.y, 1.0);
    a = inside * texture(uPath, vec2(m.x, 1.0 - m.y)).a;
  } else if (uKind == 2) {
    vec2 dir = vec2(cos(uAngle), sin(uAngle));
    float reach = abs(dir.x) * h.x + abs(dir.y) * h.y;
    a = clamp(0.5 - 0.5 * dot(q, dir) / reach, 0.0, 1.0);
  } else {
    float d;
    if (uKind == 1) {
      d = (length(q / h) - 1.0) * min(h.x, h.y);
    } else {
      vec2 e = abs(q) - h;
      d = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
    }
    float f = max(uFeather, 1.0);
    a = clamp(0.5 - d / f, 0.0, 1.0);
  }
  a = mix(a, 1.0 - a, uInvert);
  fragColor = s * a;
}
`

/**
 * Mask uniforms for one chain target. Pure; `inner` is the clip box in
 * target uv and `size` the target in px, exactly as `EffectEnv` gives them.
 */
export function maskUniforms(
  mask: ClipMask,
  inner: readonly [number, number, number, number],
  size: readonly [number, number],
  frame?: MaskFrame,
): Record<string, UniformValue> {
  const bw = inner[2] * size[0]
  const bh = inner[3] * size[1]
  // The mask's own reference box: the element's frame when given, else the
  // whole content box.
  const fw = frame ? frame.width : bw
  const fh = frame ? frame.height : bh
  const hw = (Math.abs(mask.width) * fw) / 2
  const hh = (Math.abs(mask.height) * fh) / 2
  let cx = mask.x * fw + hw
  let cy = mask.y * fh + hh
  let rotation = mask.rotation ?? 0
  if (frame) {
    // Mask centre relative to the frame centre, turned with the frame.
    const dx = cx - fw / 2
    const dy = cy - fh / 2
    const c = Math.cos(frame.rotation)
    const s = Math.sin(frame.rotation)
    cx = frame.x + fw / 2 + dx * c - dy * s
    cy = frame.y + fh / 2 + dx * s + dy * c
    rotation += frame.rotation
  }
  return {
    uKind: MASK_KIND_INDEX[mask.kind] ?? 0,
    uBoxPx: [bw, bh],
    uCenter: [cx, cy],
    uHalf: [hw, hh],
    uRotation: rotation,
    uFeather: (mask.feather ?? 0) * 2 * Math.min(hw, hh),
    uAngle: mask.angle ?? 0,
    uInvert: mask.invert ? 1 : 0,
  }
}

/** Longest side of a rasterised path mask, px. */
export const PATH_MASK_MAX_SIDE = 1024

/**
 * Rasterise a path mask onto a canvas the size of its box (capped), path
 * data in `viewBox` space stretched to fill it. Null where no canvas exists.
 */
export function rasterisePathMask(
  mask: ClipMask,
  boxWidth: number,
  boxHeight: number,
): OffscreenCanvas | HTMLCanvasElement | null {
  if (!mask.path) return null
  const long = Math.max(boxWidth, boxHeight, 1)
  const scale = Math.min(1, PATH_MASK_MAX_SIDE / long)
  const w = Math.max(8, Math.round(boxWidth * scale))
  const h = Math.max(8, Math.round(boxHeight * scale))
  let canvas: OffscreenCanvas | HTMLCanvasElement | null = null
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(w, h)
  else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
  }
  const g = canvas?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!canvas || !g || typeof Path2D === 'undefined') return null
  const vb = mask.viewBox ?? { x: 0, y: 0, width: 100, height: 100 }
  try {
    const path = new Path2D(mask.path)
    g.setTransform(w / Math.max(vb.width, 1e-6), 0, 0, h / Math.max(vb.height, 1e-6), 0, 0)
    g.translate(-vb.x, -vb.y)
    g.fillStyle = '#fff'
    g.fill(path)
  } catch {
    return null
  }
  return canvas
}

// ---------------------------------------------------------------------------
// Blend
// ---------------------------------------------------------------------------

export const BLEND_MODE_INDEX: Readonly<Record<BlendMode, number>> = {
  normal: 0,
  add: 1,
  screen: 2,
  multiply: 3,
  overlay: 4,
  softLight: 5,
  darken: 6,
  lighten: 7,
  difference: 8,
}

/**
 * Fragment shader for placing a blended clip: quad.vert's varyings, the
 * clip's (premultiplied) texture, and a copy of the backdrop under the stage
 * viewport. Drawn with GL blending OFF — it writes the final composite.
 */
export const BLEND_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uTexture;
uniform sampler2D uBackdrop;
uniform float uOpacity;
uniform vec4 uViewport;   // x, y, w, h of the stage viewport, px
uniform int uMode;
uniform sampler2D uMatte;   // track matte, rendered at the same viewport
uniform int uMatteMode;     // 0 none, 1 alpha, 2 luma
uniform float uMatteInvert;

in vec2 vTexCoord;
in vec2 vQuadUv;
out vec4 fragColor;

vec3 softLight(vec3 cb, vec3 cs) {
  vec3 d = mix(sqrt(cb), ((16.0 * cb - 12.0) * cb + 4.0) * cb, step(cb, vec3(0.25)));
  vec3 lo = cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb);
  vec3 hi = cb + (2.0 * cs - 1.0) * (d - cb);
  return mix(hi, lo, step(cs, vec3(0.5)));
}

vec3 hardLight(vec3 cb, vec3 cs) {
  vec3 lo = cb * 2.0 * cs;
  vec3 s2 = 2.0 * cs - 1.0;
  vec3 hi = cb + s2 - cb * s2;
  return mix(hi, lo, step(cs, vec3(0.5)));
}

vec3 blendFn(vec3 cb, vec3 cs) {
  if (uMode == 2) return cb + cs - cb * cs;
  if (uMode == 3) return cb * cs;
  if (uMode == 4) return hardLight(cs, cb);
  if (uMode == 5) return softLight(cb, cs);
  if (uMode == 6) return min(cb, cs);
  if (uMode == 7) return max(cb, cs);
  if (uMode == 8) return abs(cb - cs);
  return cs;
}

void main() {
  vec2 screenUv = (gl_FragCoord.xy - uViewport.xy) / uViewport.zw;
  vec4 src = texture(uTexture, vTexCoord) * uOpacity;
  if (uMatteMode > 0) {
    vec4 m = texture(uMatte, screenUv);
    // Luma of the premultiplied matte = its luminance composited over black.
    float k = uMatteMode == 1 ? m.a : dot(m.rgb, vec3(0.2126, 0.7152, 0.0722));
    k = mix(k, 1.0 - k, uMatteInvert);
    src *= clamp(k, 0.0, 1.0);
  }
  vec4 dst = texture(uBackdrop, screenUv);
  if (uMode == 1) {
    fragColor = min(src + dst, vec4(1.0));
    return;
  }
  float as = src.a;
  float ab = dst.a;
  vec3 cs = as > 0.0 ? src.rgb / as : vec3(0.0);
  vec3 cb = ab > 0.0 ? dst.rgb / ab : vec3(0.0);
  vec3 co = src.rgb * (1.0 - ab) + dst.rgb * (1.0 - as) + as * ab * clamp(blendFn(cb, cs), 0.0, 1.0);
  fragColor = vec4(co, as + ab - as * ab);
}
`
