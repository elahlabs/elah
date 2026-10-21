import { EFFECT_FRAG_HEADER, num, type GpuEffect } from './types'

/**
 * Lens-style fringing: red scaled out from the box centre, blue scaled in,
 * so the split grows toward the edges and is zero in the middle.
 */
export const chromaticAberration: GpuEffect = {
  kind: 'chromaticAberration',
  frag: EFFECT_FRAG_HEADER + /* glsl */ `
uniform float uAmount;

void main() {
  vec2 c = uInner.xy + uInner.zw * 0.5;
  vec2 d = vUv - c;
  vec4 r = texture(uTex, c + d * (1.0 + uAmount));
  vec4 g = texture(uTex, vUv);
  vec4 b = texture(uTex, c + d * (1.0 - uAmount));
  fragColor = vec4(r.r, g.g, b.b, max(max(r.a, g.a), b.a));
}
`,
  passes: () => 1,
  padding: (p, box) => (num(p, 'amount', 0) * Math.max(box.width, box.height)) / 2,
  uniforms: (p) => ({ uAmount: num(p, 'amount', 0) }),
}
