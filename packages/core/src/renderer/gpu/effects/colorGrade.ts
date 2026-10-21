import { EFFECT_FRAG_HEADER, num, type GpuEffect } from './types'

/**
 * Primary colour correction in one pass, in this order: exposure →
 * white balance (temperature, tint) → hue → saturation → contrast →
 * lift / gain → gamma. Works on unpremultiplied colour and re-premultiplies,
 * so graded semi-transparent edges keep their alpha.
 */
export const colorGrade: GpuEffect = {
  kind: 'colorGrade',
  frag: EFFECT_FRAG_HEADER + /* glsl */ `
uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform vec2 uBalance;   // temperature, tint
uniform float uHue;      // radians
uniform vec3 uLiftGammaGain;

vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

void main() {
  vec4 s = texture(uTex, vUv);
  if (s.a <= 0.0) { fragColor = s; return; }
  vec3 c = unpremul(s);
  c *= exp2(uExposure);
  c *= vec3(1.0 + 0.15 * uBalance.x, 1.0 - 0.15 * uBalance.y, 1.0 - 0.15 * uBalance.x);
  c = hueRotate(c, uHue);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  c = (c - 0.5) * uContrast + 0.5;
  c = c * uLiftGammaGain.z + uLiftGammaGain.x * (1.0 - c);
  c = pow(max(c, vec3(0.0)), vec3(1.0 / uLiftGammaGain.y));
  c = clamp(c, 0.0, 1.0);
  fragColor = vec4(c * s.a, s.a);
}
`,
  passes: () => 1,
  uniforms: (p) => ({
    uExposure: num(p, 'exposure', 0),
    uContrast: num(p, 'contrast', 1),
    uSaturation: num(p, 'saturation', 1),
    uBalance: [num(p, 'temperature', 0), num(p, 'tint', 0)],
    uHue: (num(p, 'hue', 0) * Math.PI) / 180,
    uLiftGammaGain: [num(p, 'lift', 0), Math.max(0.01, num(p, 'gamma', 1)), num(p, 'gain', 1)],
  }),
}
