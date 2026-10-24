import { EFFECT_FRAG_HEADER, num, type GpuEffect } from './types'

/** Taps each side of the centre; wider blurs stride instead of adding taps. */
export const BLUR_MAX_TAPS = 32

/**
 * Separable Gaussian: pass 0 horizontal, pass 1 vertical. `radius` is in
 * stage pixels and is the visible reach of the blur (σ = radius / 2, so the
 * kernel is cut at ±1.5 × radius = 3σ). Premultiplied input blurs correctly
 * into the transparent padding around the clip.
 */
export const gaussianBlur: GpuEffect = {
  kind: 'gaussianBlur',
  frag: EFFECT_FRAG_HEADER + /* glsl */ `
uniform vec2 uDir;
uniform float uSigma;

void main() {
  if (uSigma < 0.01) { fragColor = texture(uTex, vUv); return; }
  float reach = ceil(uSigma * 3.0);
  float stride = max(1.0, reach / ${BLUR_MAX_TAPS}.0);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -${BLUR_MAX_TAPS}; i <= ${BLUR_MAX_TAPS}; i++) {
    float x = float(i) * stride;
    if (abs(x) > reach) continue;
    float w = exp(-0.5 * x * x / (uSigma * uSigma));
    acc += texture(uTex, vUv + uDir * uTexel * x) * w;
    wsum += w;
  }
  fragColor = acc / wsum;
}
`,
  passes: () => 2,
  padding: (p) => num(p, 'radius', 0) * 1.5,
  uniforms: (p, env) => {
    const radius = num(p, 'radius', 0)
    const horizontal = env.pass === 0
    const k = horizontal ? env.pxPerStagePx[0] : env.pxPerStagePx[1]
    return {
      uDir: horizontal ? [1, 0] : [0, 1],
      uSigma: (radius * k) / 2,
    }
  },
}
