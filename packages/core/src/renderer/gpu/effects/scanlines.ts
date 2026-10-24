import { EFFECT_FRAG_HEADER, num, type GpuEffect } from './types'

/**
 * CRT-style horizontal lines. `density` is lines across the box height;
 * `speed` scrolls them in lines per second.
 */
export const scanlines: GpuEffect = {
  kind: 'scanlines',
  frag: EFFECT_FRAG_HEADER + /* glsl */ `
uniform float uDensity;
uniform float uIntensity;
uniform float uSpeed;

void main() {
  vec4 s = texture(uTex, vUv);
  float phase = boxUv(vUv).y * uDensity + uTime * uSpeed;
  float f = 1.0 - uIntensity * (0.5 + 0.5 * cos(6.28318531 * phase));
  fragColor = vec4(s.rgb * f, s.a);
}
`,
  passes: () => 1,
  uniforms: (p) => ({
    uDensity: num(p, 'density', 480),
    uIntensity: num(p, 'intensity', 0),
    uSpeed: num(p, 'speed', 0),
  }),
}
