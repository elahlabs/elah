import { EFFECT_FRAG_HEADER, hexToRgb, num, type GpuEffect } from './types'

/**
 * Darkens (or tints) toward the box edges. Distance is measured in the box's
 * own 0..1 space, so the vignette is elliptical and follows the frame shape —
 * 0 at the centre, 1 at the corners. `radius` is where the falloff ends,
 * `softness` how far inward it starts.
 */
export const vignette: GpuEffect = {
  kind: 'vignette',
  frag: EFFECT_FRAG_HEADER + /* glsl */ `
uniform float uAmount;
uniform float uRadius;
uniform float uSoftness;
uniform vec3 uColor;

void main() {
  vec4 s = texture(uTex, vUv);
  vec2 b = boxUv(vUv) - 0.5;
  float d = length(b * 2.0) / 1.41421356;
  float f = smoothstep(uRadius - uSoftness, uRadius, d) * uAmount;
  fragColor = vec4(mix(s.rgb, uColor * s.a, f), s.a);
}
`,
  passes: () => 1,
  uniforms: (p) => ({
    uAmount: num(p, 'amount', 0),
    uRadius: num(p, 'radius', 0.75),
    uSoftness: Math.max(0.01, num(p, 'softness', 0.45)),
    uColor: hexToRgb(p.color),
  }),
}
