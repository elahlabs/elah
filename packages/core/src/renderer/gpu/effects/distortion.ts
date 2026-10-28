import { EFFECT_FRAG_HEADER, boxAspect, num, type GpuEffect } from './types'

/**
 * Distortions (EDX-P9): wave, twirl, bulge/pinch, fisheye, noise displace.
 *
 * Each remaps WHERE a pixel samples from, in the clip box's own 0..1 space
 * (`boxUv`), with circular maths corrected by the box aspect so a twirl is a
 * circle on a 16:9 clip. Samples that land outside the box read the chain's
 * transparent padding, so the clip's edge stays clean.
 */

const SAMPLE_BOX = /* glsl */ `
uniform float uAspect;   // box width / height
vec4 sampleBox(vec2 b) {
  vec2 inside = step(vec2(0.0), b) * step(b, vec2(1.0));
  return texture(uTex, uInner.xy + b * uInner.zw) * inside.x * inside.y;
}
// Box uv -> aspect-corrected space (x scaled by aspect) and back.
vec2 toRound(vec2 b) { return vec2(b.x * uAspect, b.y); }
vec2 fromRound(vec2 r) { return vec2(r.x / uAspect, r.y); }
`

export const wave: GpuEffect = {
  kind: 'wave',
  frag:
    EFFECT_FRAG_HEADER +
    SAMPLE_BOX +
    /* glsl */ `
uniform float uAmplitude;
uniform float uFrequency;
uniform float uSpeed;
uniform float uVertical;

void main() {
  vec2 b = boxUv(vUv);
  float phase = 6.2831853 * (uFrequency * (uVertical > 0.5 ? b.x : b.y) + uSpeed * uTime);
  vec2 o = uVertical > 0.5 ? vec2(0.0, uAmplitude * sin(phase)) : vec2(uAmplitude * sin(phase), 0.0);
  fragColor = sampleBox(b + o);
}
`,
  passes: () => 1,
  padding: (p, box) => num(p, 'amplitude', 0.02) * Math.max(box.width, box.height),
  uniforms: (p, env) => ({
    uAspect: boxAspect(env),
    uAmplitude: num(p, 'amplitude', 0.02),
    uFrequency: num(p, 'frequency', 6),
    uSpeed: num(p, 'speed', 1),
    uVertical: p.direction === 'vertical' ? 1 : 0,
  }),
}

export const twirl: GpuEffect = {
  kind: 'twirl',
  frag:
    EFFECT_FRAG_HEADER +
    SAMPLE_BOX +
    /* glsl */ `
uniform float uAngle;    // radians at the centre
uniform float uRadius;   // fraction of the box height
uniform vec2 uCenter;    // box uv

void main() {
  vec2 b = boxUv(vUv);
  vec2 d = toRound(b) - toRound(uCenter);
  float r = length(d);
  if (r < uRadius) {
    float k = 1.0 - r / uRadius;
    float a = uAngle * k * k;
    float c = cos(a), s = sin(a);
    d = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
  }
  fragColor = sampleBox(fromRound(toRound(uCenter) + d));
}
`,
  passes: () => 1,
  uniforms: (p, env) => ({
    uAspect: boxAspect(env),
    uAngle: (num(p, 'angle', 180) * Math.PI) / 180,
    uRadius: Math.max(0.001, num(p, 'radius', 0.5)),
    uCenter: [num(p, 'centerX', 0.5), 1 - num(p, 'centerY', 0.5)],
  }),
}

/** Bulge (amount > 0) magnifies the centre; pinch (< 0) squeezes it. */
export const bulge: GpuEffect = {
  kind: 'bulge',
  frag:
    EFFECT_FRAG_HEADER +
    SAMPLE_BOX +
    /* glsl */ `
uniform float uAmount;
uniform float uRadius;
uniform vec2 uCenter;

void main() {
  vec2 b = boxUv(vUv);
  vec2 d = toRound(b) - toRound(uCenter);
  float r = length(d);
  if (r < uRadius && r > 0.0) {
    float n = r / uRadius;
    d = d / r * uRadius * pow(n, 1.0 + uAmount);
  }
  fragColor = sampleBox(fromRound(toRound(uCenter) + d));
}
`,
  passes: () => 1,
  uniforms: (p, env) => ({
    uAspect: boxAspect(env),
    uAmount: num(p, 'amount', 0.5),
    uRadius: Math.max(0.001, num(p, 'radius', 0.4)),
    uCenter: [num(p, 'centerX', 0.5), 1 - num(p, 'centerY', 0.5)],
  }),
}

/** Barrel lens: the centre swells, the corners hold. */
export const fisheye: GpuEffect = {
  kind: 'fisheye',
  frag:
    EFFECT_FRAG_HEADER +
    SAMPLE_BOX +
    /* glsl */ `
uniform float uAmount;

void main() {
  vec2 b = boxUv(vUv);
  vec2 d = b - 0.5;
  float r2 = min(0.5, dot(d, d));
  float f = 1.0 - uAmount * (0.5 - r2);
  fragColor = sampleBox(0.5 + d * f);
}
`,
  passes: () => 1,
  uniforms: (p, env) => ({ uAspect: boxAspect(env), uAmount: num(p, 'amount', 0.5) }),
}

const NOISE = /* glsl */ `
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
`

/** Smooth noise pushes pixels around — heat haze, underwater, a nervous edge. */
export const displace: GpuEffect = {
  kind: 'displace',
  frag:
    EFFECT_FRAG_HEADER +
    SAMPLE_BOX +
    NOISE +
    /* glsl */ `
uniform float uAmount;
uniform float uScale;
uniform float uSpeed;
uniform float uSeed;

void main() {
  vec2 b = boxUv(vUv);
  vec2 p = toRound(b) * uScale + vec2(uSeed * 17.0, uSeed * 31.0) + uTime * uSpeed;
  vec2 o = vec2(vnoise(p) - 0.5, vnoise(p + 91.7) - 0.5) * uAmount;
  fragColor = sampleBox(b + o);
}
`,
  passes: () => 1,
  padding: (p, box) => num(p, 'amount', 0.03) * 0.5 * Math.max(box.width, box.height),
  uniforms: (p, env) => ({
    uAspect: boxAspect(env),
    uAmount: num(p, 'amount', 0.03),
    uScale: num(p, 'scale', 6),
    uSpeed: num(p, 'speed', 0.5),
    uSeed: num(p, 'seed', 3),
  }),
}

export { NOISE as DISTORTION_NOISE_GLSL }
