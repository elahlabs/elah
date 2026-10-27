import { EFFECT_FRAG_HEADER, hexToRgb, num, type EffectEnv, type EffectParams, type GpuEffect } from './types'

/**
 * Light effects (EDX-P9): bloom, glow, flash, strobe, light rays.
 *
 * Bloom, glow and rays need "the picture plus something blurred from it".
 * The chain feeds each pass only the previous pass, so each is ONE pass that
 * gathers a golden-angle disc (or a ray march) around the pixel and adds it
 * to the untouched centre sample — no second texture, no extra target.
 */

/** Stage-px radius → uv radius per axis on the chain target. */
function radiusUv(params: EffectParams, env: EffectEnv, name = 'radius', fallback = 24): [number, number] {
  const r = Math.max(0, num(params, name, fallback))
  return [(r * env.pxPerStagePx[0]) / env.size[0], (r * env.pxPerStagePx[1]) / env.size[1]]
}

const DISC = /* glsl */ `
const int TAPS = 32;
// Golden-angle disc tap i in 0..TAPS-1 → offset in unit disc, and its weight.
vec2 discTap(int i, out float w) {
  float fi = float(i) + 0.5;
  float r = sqrt(fi / float(TAPS));
  float a = fi * 2.39996323;
  w = 1.0 - r * 0.6;
  return vec2(cos(a), sin(a)) * r;
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`

export const bloom: GpuEffect = {
  kind: 'bloom',
  frag:
    EFFECT_FRAG_HEADER +
    DISC +
    /* glsl */ `
uniform float uThreshold;
uniform float uIntensity;
uniform vec2 uRadius;
uniform vec3 uTint;

void main() {
  vec4 s = texture(uTex, vUv);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < TAPS; i++) {
    float w;
    vec2 o = discTap(i, w) * uRadius;
    vec4 c = texture(uTex, vUv + o);
    vec3 u = unpremul(c);
    float k = smoothstep(uThreshold, uThreshold + 0.2, luma(u)) * c.a;
    acc += u * k * w;
    wsum += w;
  }
  vec3 add = acc / wsum * uIntensity * uTint;
  float a = clamp(max(s.a, max(add.r, max(add.g, add.b))), 0.0, 1.0);
  fragColor = vec4(min(s.rgb + add, vec3(a)), a);
}
`,
  passes: () => 1,
  padding: (p) => num(p, 'radius', 24),
  uniforms: (p, env) => ({
    uThreshold: num(p, 'threshold', 0.7),
    uIntensity: num(p, 'intensity', 0.8),
    uRadius: radiusUv(p, env),
    uTint: hexToRgb(p.tint),
  }),
}

/** A soft halo from the clip's own ALPHA — the glow around text and shapes. */
export const glow: GpuEffect = {
  kind: 'glow',
  frag:
    EFFECT_FRAG_HEADER +
    DISC +
    /* glsl */ `
uniform float uIntensity;
uniform vec2 uRadius;
uniform vec3 uColor;

void main() {
  vec4 s = texture(uTex, vUv);
  float acc = 0.0;
  float wsum = 0.0;
  for (int i = 0; i < TAPS; i++) {
    float w;
    vec2 o = discTap(i, w) * uRadius;
    acc += texture(uTex, vUv + o).a * w;
    wsum += w;
  }
  float g = clamp(acc / wsum * uIntensity, 0.0, 1.0);
  fragColor = s + vec4(uColor * g, g) * (1.0 - s.a);
}
`,
  passes: () => 1,
  padding: (p) => num(p, 'radius', 24),
  uniforms: (p, env) => ({
    uIntensity: num(p, 'intensity', 1.5),
    uRadius: radiusUv(p, env),
    uColor: hexToRgb(p.color),
  }),
}

/** Pushes the picture toward a colour — keyed, it is the classic white flash. */
export const flash: GpuEffect = {
  kind: 'flash',
  frag:
    EFFECT_FRAG_HEADER +
    /* glsl */ `
uniform float uAmount;
uniform vec3 uColor;

void main() {
  vec4 s = texture(uTex, vUv);
  fragColor = vec4(mix(s.rgb, uColor * s.a, uAmount), s.a);
}
`,
  passes: () => 1,
  uniforms: (p) => ({ uAmount: num(p, 'amount', 0.8), uColor: hexToRgb(p.color) }),
}

/** Flashes on and off with the clock: `rate` flashes a second, `duty` of each on. */
export const strobe: GpuEffect = {
  kind: 'strobe',
  frag:
    EFFECT_FRAG_HEADER +
    /* glsl */ `
uniform float uRate;
uniform float uDuty;
uniform float uAmount;
uniform vec3 uColor;

void main() {
  vec4 s = texture(uTex, vUv);
  float on = step(fract(uTime * uRate), uDuty);
  fragColor = vec4(mix(s.rgb, uColor * s.a, on * uAmount), s.a);
}
`,
  passes: () => 1,
  uniforms: (p) => ({
    uRate: num(p, 'rate', 8),
    uDuty: num(p, 'duty', 0.5),
    uAmount: num(p, 'amount', 0.8),
    uColor: p.mode === 'black' ? [0, 0, 0] : [1, 1, 1],
  }),
}

/** God rays: bright areas smeared toward a centre point. */
export const lightRays: GpuEffect = {
  kind: 'lightRays',
  frag:
    EFFECT_FRAG_HEADER +
    /* glsl */ `
uniform vec2 uCenter;     // box uv
uniform float uLength;
uniform float uIntensity;
uniform float uThreshold;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec4 s = texture(uTex, vUv);
  vec2 b = boxUv(vUv);
  vec3 acc = vec3(0.0);
  float decay = 1.0;
  float wsum = 0.0;
  for (int i = 0; i < 40; i++) {
    float t = float(i) / 40.0;
    vec2 pb = mix(b, uCenter, t * uLength);
    vec4 c = texture(uTex, uInner.xy + pb * uInner.zw);
    vec3 u = unpremul(c);
    acc += u * smoothstep(uThreshold, uThreshold + 0.2, luma(u)) * c.a * decay;
    wsum += decay;
    decay *= 0.96;
  }
  vec3 add = acc / wsum * uIntensity;
  float a = clamp(max(s.a, max(add.r, max(add.g, add.b))), 0.0, 1.0);
  fragColor = vec4(min(s.rgb + add, vec3(a)), a);
}
`,
  passes: () => 1,
  uniforms: (p) => ({
    uCenter: [num(p, 'centerX', 0.5), 1 - num(p, 'centerY', 0.2)],
    uLength: num(p, 'length', 0.6),
    uIntensity: num(p, 'intensity', 1),
    uThreshold: num(p, 'threshold', 0.6),
  }),
}

