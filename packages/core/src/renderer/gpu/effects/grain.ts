import { EFFECT_FRAG_HEADER, num, type GpuEffect } from './types'

/**
 * Monochrome film grain from a hash, not a texture, so it needs no asset and
 * is the same on every run: the pattern depends only on the pixel cell, the
 * seed and (when animated) the frame. `size` is the grain cell in stage px.
 */
export const grain: GpuEffect = {
  kind: 'grain',
  frag: EFFECT_FRAG_HEADER + /* glsl */ `
uniform float uAmount;
uniform float uCell;     // chain px per grain cell
uniform float uSeed;     // seed + frame when animated

float hash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec4 s = texture(uTex, vUv);
  vec2 cell = floor(gl_FragCoord.xy / uCell);
  float n = hash(vec3(cell, mod(uSeed, 4096.0))) - 0.5;
  vec3 c = clamp(s.rgb + n * uAmount * 0.5 * s.a, 0.0, s.a);
  fragColor = vec4(c, s.a);
}
`,
  passes: () => 1,
  uniforms: (p, env) => {
    const k = (env.pxPerStagePx[0] + env.pxPerStagePx[1]) / 2
    const animated = p.animated !== false
    return {
      uAmount: num(p, 'amount', 0),
      uCell: Math.max(0.5, num(p, 'size', 1.5) * k),
      uSeed: num(p, 'seed', 0) + (animated ? env.frame : 0),
    }
  },
}
