import { EFFECT_FRAG_HEADER, num, type GpuEffect } from './types'

/**
 * Shifts red one way and blue the other along `angle`. `amount` is a
 * fraction of the clip box's width, so the look does not change with zoom.
 */
export const rgbSplit: GpuEffect = {
  kind: 'rgbSplit',
  frag: EFFECT_FRAG_HEADER + /* glsl */ `
uniform vec2 uOffset;   // uv

void main() {
  vec4 r = texture(uTex, vUv + uOffset);
  vec4 g = texture(uTex, vUv);
  vec4 b = texture(uTex, vUv - uOffset);
  fragColor = vec4(r.r, g.g, b.b, max(max(r.a, g.a), b.a));
}
`,
  passes: () => 1,
  padding: (p, box) => num(p, 'amount', 0) * box.width,
  uniforms: (p, env) => {
    const amount = num(p, 'amount', 0)
    const angle = (num(p, 'angle', 0) * Math.PI) / 180
    // Offset in chain px = amount × box width px, then back to uv per axis.
    const px = amount * env.inner[2] * env.size[0]
    return {
      uOffset: [(px * Math.cos(angle)) / env.size[0], (px * Math.sin(angle)) / env.size[1]],
    }
  },
}
