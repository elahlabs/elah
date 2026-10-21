/**
 * GPU transitions (EDX-P9c): ONE fragment shader that composites the
 * outgoing and incoming clips, each already rendered with all its effects,
 * transform, mask and blend into its own full-frame target — so an effected
 * clip keeps its look through the transition, and both keep playing (the old
 * path froze the outgoing frame and dropped its effects in export).
 *
 * Both inputs are premultiplied, full-viewport, GL orientation. The output is
 * premultiplied and is blended over whatever is already in the frame.
 *
 * The legacy three reproduce the old CSS/2D maths: fade = outgoing over
 * incoming at 1−t; slide = outgoing moves away by t; wipe = outgoing keeps the
 * left 1−t.
 */

import type { TransitionDirection, TransitionKind } from '../../types'

export const TRANSITION_KIND_INDEX: Readonly<Record<TransitionKind, number>> = {
  fade: 0,
  slide: 1,
  wipe: 2,
  zoom: 3,
  spin: 4,
  whip: 5,
  glitchCut: 6,
  warpDissolve: 7,
  lumaWipe: 8,
}

/** Unit direction (GL: +y is up) the outgoing clip moves toward. */
export function transitionDirection(direction: TransitionDirection | undefined): [number, number] {
  switch (direction) {
    case 'left':
      return [-1, 0]
    case 'up':
      return [0, 1]
    case 'down':
      return [0, -1]
    default:
      return [1, 0]
  }
}

export const TRANSITION_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float uT;
uniform int uKind;
uniform vec2 uDir;
uniform float uAspect;

in vec2 vUv;
out vec4 fragColor;

vec4 over(vec4 top, vec4 bottom) { return top + bottom * (1.0 - top.a); }

vec4 sampleIn(sampler2D tex, vec2 uv) {
  vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return texture(tex, uv) * inside.x * inside.y;
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Scale/rotate a uv about the centre, in aspect-correct space.
vec2 about(vec2 uv, float scale, float angle) {
  vec2 d = (uv - 0.5) * vec2(uAspect, 1.0);
  float c = cos(angle), s = sin(angle);
  d = vec2(c * d.x - s * d.y, s * d.x + c * d.y) / scale;
  return d / vec2(uAspect, 1.0) + 0.5;
}

void main() {
  float t = clamp(uT, 0.0, 1.0);
  vec2 uv = vUv;
  vec4 a = texture(uFrom, uv);
  vec4 b = texture(uTo, uv);

  if (uKind == 0) {
    // Cross-fade: outgoing over incoming, fading out.
    fragColor = over(a * (1.0 - t), b);
  } else if (uKind == 1) {
    // Slide: outgoing moves away along uDir, incoming revealed underneath.
    fragColor = over(sampleIn(uFrom, uv - uDir * t), b);
  } else if (uKind == 2) {
    // Wipe: outgoing keeps the left (1 - t) of the frame.
    fragColor = uv.x < 1.0 - t ? over(a, b) : b;
  } else if (uKind == 3) {
    // Zoom: push into the outgoing clip, arrive from slightly zoomed-out.
    float e = t * t * (3.0 - 2.0 * t);
    vec4 za = sampleIn(uFrom, about(uv, 1.0 + e * 1.5, 0.0));
    vec4 zb = sampleIn(uTo, about(uv, 0.7 + e * 0.3, 0.0));
    fragColor = over(za * (1.0 - e), zb * e);
  } else if (uKind == 4) {
    // Spin: rotate a quarter turn out, the incoming a quarter turn in.
    float e = t * t * (3.0 - 2.0 * t);
    vec4 sa = sampleIn(uFrom, about(uv, 1.0 - e * 0.5, e * 1.5707963));
    vec4 sb = sampleIn(uTo, about(uv, 0.5 + e * 0.5, (e - 1.0) * 1.5707963));
    fragColor = over(sa * (1.0 - e), sb * e);
  } else if (uKind == 5) {
    // Whip pan: both clips race along uDir with a directional blur; switch at the middle.
    float e = t * t * (3.0 - 2.0 * t);
    float blur = sin(t * 3.14159265) * 0.18;
    vec4 acc = vec4(0.0);
    for (int i = 0; i < 12; i++) {
      float k = (float(i) / 11.0 - 0.5) * blur;
      vec2 p = uv + uDir * k;
      vec4 wa = sampleIn(uFrom, p - uDir * e);
      vec4 wb = sampleIn(uTo, p + uDir * (1.0 - e));
      acc += over(wa, wb);
    }
    fragColor = acc / 12.0;
  } else if (uKind == 6) {
    // Glitch cut: blocks jump and tear for a few frames either side of the cut.
    float burst = 1.0 - abs(t - 0.5) * 2.0;
    float tick = floor(t * 24.0);
    vec2 cell = floor(vec2(uv.x * 6.0, uv.y * 18.0));
    float h = hash21(cell + tick * 7.13);
    float on = step(1.0 - burst * 0.6, h);
    float shift = (hash21(cell.yy + tick) - 0.5) * 0.2 * on;
    vec2 gu = uv + vec2(shift, 0.0);
    vec4 src = t < 0.5 ? texture(uFrom, gu) : texture(uTo, gu);
    float r = (t < 0.5 ? texture(uFrom, gu + vec2(0.012 * on, 0.0)) : texture(uTo, gu + vec2(0.012 * on, 0.0))).r;
    float bl = (t < 0.5 ? texture(uFrom, gu - vec2(0.012 * on, 0.0)) : texture(uTo, gu - vec2(0.012 * on, 0.0))).b;
    fragColor = vec4(min(vec3(r, src.g, bl), vec3(src.a)), src.a);
  } else if (uKind == 7) {
    // Warp dissolve: a noise threshold eats the outgoing clip, warping near the edge.
    float n = vnoise(uv * vec2(uAspect, 1.0) * 5.0) * 0.7 + vnoise(uv * vec2(uAspect, 1.0) * 17.0) * 0.3;
    float edge = smoothstep(t - 0.08, t + 0.08, n);
    vec2 warp = (vec2(vnoise(uv * 9.0 + t), vnoise(uv * 9.0 - t)) - 0.5) * 0.06 * (1.0 - abs(edge * 2.0 - 1.0));
    vec4 wa = sampleIn(uFrom, uv + warp);
    fragColor = over(wa * edge, b);
  } else {
    // Luma fade: the outgoing clip's darks go first.
    vec3 ua = a.a > 0.0 ? a.rgb / a.a : vec3(0.0);
    float l = dot(ua, vec3(0.2126, 0.7152, 0.0722));
    float keep = smoothstep(t - 0.12, t + 0.12, l * 0.85 + 0.075);
    fragColor = over(a * keep, b);
  }
}
`
