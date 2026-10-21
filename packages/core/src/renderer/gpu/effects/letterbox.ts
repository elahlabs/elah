import { boxAspect, EFFECT_FRAG_HEADER, hexToRgb, num, type GpuEffect } from './types'

/**
 * Cinema bars inside the clip's box. `ratio` is the target aspect; a box
 * already wider than it gets no bars (letterbox never pillarboxes).
 */
export function letterboxBar(ratio: number, aspect: number): number {
  if (!(ratio > 0) || !(aspect > 0) || ratio <= aspect) return 0
  return (1 - aspect / ratio) / 2
}

export const letterbox: GpuEffect = {
  kind: 'letterbox',
  frag: EFFECT_FRAG_HEADER + /* glsl */ `
uniform float uBar;     // fraction of box height, each side
uniform vec3 uColor;

void main() {
  vec4 s = texture(uTex, vUv);
  vec2 b = boxUv(vUv);
  float bar = inBox(vUv) * (step(b.y, uBar) + step(1.0 - uBar, b.y));
  fragColor = bar > 0.0 && uBar > 0.0 ? vec4(uColor, 1.0) : s;
}
`,
  passes: () => 1,
  uniforms: (p, env) => ({
    uBar: letterboxBar(num(p, 'ratio', 2.39), boxAspect(env)),
    uColor: hexToRgb(p.color),
  }),
}
