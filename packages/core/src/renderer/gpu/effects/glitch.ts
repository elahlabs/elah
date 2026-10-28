import { EFFECT_FRAG_HEADER, num, type GpuEffect } from './types'
import { DISTORTION_NOISE_GLSL } from './distortion'

/**
 * Glitch and retro v2 (EDX-P9): VHS, CRT, pixelate, glitch blocks. All
 * deterministic — the only randomness is a hash of (cell, seed, frame), so a
 * given frame looks the same in preview and export and on every run.
 */

const SAMPLE = /* glsl */ `
vec4 sampleBox(vec2 b) {
  vec2 inside = step(vec2(0.0), b) * step(b, vec2(1.0));
  return texture(uTex, uInner.xy + b * uInner.zw) * inside.x * inside.y;
}
`

export const vhs: GpuEffect = {
  kind: 'vhs',
  frag:
    EFFECT_FRAG_HEADER +
    SAMPLE +
    DISTORTION_NOISE_GLSL +
    /* glsl */ `
uniform float uAmount;
uniform float uFrame;

void main() {
  vec2 b = boxUv(vUv);
  float line = floor(b.y * 240.0);
  // Horizontal tape jitter per line, plus a slow wobble.
  float jitter = (hash21(vec2(line, uFrame)) - 0.5) * 0.004 + sin(b.y * 12.0 + uTime * 2.0) * 0.0015;
  // A tracking band that rolls up the frame.
  float band = smoothstep(0.0, 0.02, abs(fract(b.y + uTime * 0.07) - 0.5) - 0.46);
  vec2 bj = b + vec2((jitter + (1.0 - band) * 0.01) * uAmount, 0.0);
  float ca = 0.004 * uAmount;
  vec4 g = sampleBox(bj);
  float r = sampleBox(bj + vec2(ca, 0.0)).r;
  float bl = sampleBox(bj - vec2(ca, 0.0)).b;
  vec3 c = vec3(r, g.g, bl);
  // Soften saturation and lift blacks like tape.
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(l), 0.25 * uAmount) + 0.03 * uAmount * g.a;
  // Snow.
  float n = hash21(gl_FragCoord.xy + uFrame * 13.0) - 0.5;
  c += n * 0.08 * uAmount * g.a;
  fragColor = vec4(clamp(c, 0.0, g.a), g.a);
}
`,
  passes: () => 1,
  padding: (p, box) => 0.02 * num(p, 'amount', 0.6) * box.width,
  uniforms: (p, env) => ({ uAmount: num(p, 'amount', 0.6), uFrame: env.frame }),
}

export const crt: GpuEffect = {
  kind: 'crt',
  frag:
    EFFECT_FRAG_HEADER +
    SAMPLE +
    /* glsl */ `
uniform float uCurvature;
uniform float uScanlines;
uniform float uVignette;
uniform float uMask;
uniform float uLines;

void main() {
  vec2 b = boxUv(vUv);
  vec2 d = b * 2.0 - 1.0;
  d *= 1.0 + uCurvature * (d.yx * d.yx);
  vec2 cb = (d + 1.0) * 0.5;
  vec4 s = sampleBox(cb);
  vec3 c = s.rgb;
  float sl = 0.5 + 0.5 * cos(cb.y * uLines * 6.2831853);
  c *= 1.0 - uScanlines * 0.6 * (1.0 - sl);
  float m = mod(floor(gl_FragCoord.x), 3.0);
  vec3 mask = vec3(m == 0.0 ? 1.0 : 1.0 - uMask, m == 1.0 ? 1.0 : 1.0 - uMask, m == 2.0 ? 1.0 : 1.0 - uMask);
  c *= mask;
  float v = smoothstep(1.4, 0.6, length(d));
  c *= mix(1.0, v, uVignette);
  fragColor = vec4(clamp(c, 0.0, s.a), s.a);
}
`,
  passes: () => 1,
  uniforms: (p, env) => ({
    uCurvature: num(p, 'curvature', 0.12),
    uScanlines: num(p, 'scanlines', 0.35),
    uVignette: num(p, 'vignette', 0.35),
    uMask: num(p, 'mask', 0.2),
    // Roughly one scanline per 3 chain px of box height.
    uLines: Math.max(40, (env.inner[3] * env.size[1]) / 3),
  }),
}

export const pixelate: GpuEffect = {
  kind: 'pixelate',
  frag:
    EFFECT_FRAG_HEADER +
    SAMPLE +
    /* glsl */ `
uniform vec2 uCells;   // cells across the box, per axis

void main() {
  vec2 b = boxUv(vUv);
  vec2 q = (floor(b * uCells) + 0.5) / uCells;
  fragColor = sampleBox(q) * inBox(vUv);
}
`,
  passes: () => 1,
  uniforms: (p, env) => {
    const cell = Math.max(1, num(p, 'size', 12))
    const w = (env.inner[2] * env.size[0]) / env.pxPerStagePx[0]
    const h = (env.inner[3] * env.size[1]) / env.pxPerStagePx[1]
    return { uCells: [Math.max(1, w / cell), Math.max(1, h / cell)] }
  },
}

/** Rows of blocks jump sideways with an RGB tear, a few times a second. */
export const glitchBlocks: GpuEffect = {
  kind: 'glitchBlocks',
  frag:
    EFFECT_FRAG_HEADER +
    SAMPLE +
    DISTORTION_NOISE_GLSL +
    /* glsl */ `
uniform float uAmount;
uniform float uBlock;
uniform float uTick;
uniform float uSeed;

void main() {
  vec2 b = boxUv(vUv);
  vec2 cell = floor(vec2(b.x / (uBlock * 4.0), b.y / uBlock));
  float h = hash21(cell + vec2(uTick * 7.13, uSeed));
  float on = step(1.0 - uAmount * 0.35, h);
  float shift = (hash21(cell.yy + uTick + uSeed * 3.1) - 0.5) * 0.15 * on;
  vec2 bs = b + vec2(shift, 0.0);
  vec4 g = sampleBox(bs);
  float r = sampleBox(bs + vec2(0.01 * on, 0.0)).r;
  float bl = sampleBox(bs - vec2(0.01 * on, 0.0)).b;
  fragColor = vec4(min(vec3(r, g.g, bl), vec3(g.a)), g.a);
}
`,
  passes: () => 1,
  padding: (_p, box) => 0.08 * box.width,
  uniforms: (p, env) => ({
    uAmount: num(p, 'amount', 0.5),
    uBlock: Math.max(0.01, num(p, 'blockSize', 0.06)),
    uTick: Math.floor(env.time * num(p, 'speed', 8)),
    uSeed: num(p, 'seed', 5),
  }),
}
