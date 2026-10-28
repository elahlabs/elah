import { MOTION_BLUR_INPUTS } from '../../../effects/registry'
import { EFFECT_FRAG_HEADER, num, type EffectEnv, type EffectParams, type GpuEffect } from './types'

/**
 * Motion blur along the clip's own motion (MI-P8).
 *
 * CONTRACT (the one place it is written down)
 *
 *  Inputs, in the RESOLVED params the chain hands `uniforms()` / `skip()`:
 *   - Registry params: `shutter` 0..1, `samples` 4..32, `minPx`, `auto`,
 *     `angle` (deg, 0 = +x, 90 = down) and `length` (px) for `auto: false`.
 *   - Resolver inputs, only when `auto` is true (names in
 *     `MOTION_BLUR_INPUTS`, set by `resolver/resolveTimeline.ts`):
 *       velX, velY  stage px PER FRAME the clip's anchor point moved
 *                   (screen space, +x right, +y down), central difference of
 *                   the clip's resolved transform one frame either side.
 *       velSpin     radians per frame (clockwise positive).
 *       velZoom     fractional scale change per frame.
 *     Absent = 0, so a clip the resolver never measured does not blur.
 *
 *  Reduction to one blur (documented here, tested in motionBlur.parity):
 *   - The streak is the translation vector `(velX, velY)` times `shutter`;
 *     the kernel runs from -half to +half of it, centred on the pixel.
 *   - Rotation and scale move every corner of the box, not just its centre.
 *     About the box centre each corner (all at the half-diagonal `r`) moves
 *     `r*|velSpin|` TANGENTIALLY for a spin and `r*|velZoom|` RADIALLY for a
 *     zoom; the two are orthogonal, so each corner's residual has magnitude
 *     `r*hypot(velSpin, velZoom)`. That mean residual is an ISOTROPIC term:
 *     the kernel is widened by a disc of that radius (times `shutter`)
 *     instead of a direction, because corners move in four different
 *     directions. `r` comes from the box the chain actually draws, so the
 *     resolver never needs the clip's pixel size.
 *   - The resolver tracks the ANCHOR point. Scale about an anchor that is not
 *     the box centre also shifts the centre; that shift is not added.
 *
 *  Below `minPx` of total travel per frame (translation + isotropic term) the
 *  effect is skipped by the chain (`skip`): no pass, no padding, no compile.
 *
 *  Uniforms (chain target uv). The chain textures are uploaded FLIP_Y, so +v
 *  points UP the screen while stage +y (and `velY`, and angle 90) points DOWN:
 *  `uExtent.y` is therefore the NEGATED stage-y streak. (Measured on a real GPU
 *  before this fix: a down-right move smeared up-right, covariance -4.)
 *   - `uExtent` vec2: the full streak, shutter applied, clamped so the reach
 *     (half streak + disc radius) stays inside the 200 px padding.
 *   - `uSpread` vec2: the disc radius per axis, same clamp.
 *   - `uSamples` float: tap count, integer 4..32.
 *
 *  Colour is premultiplied in and out, so averaging taps is correct and the
 *  transparent padding fades the streak out naturally.
 */

/** Largest reach (half streak + disc radius) in stage px: the registry padding. */
export const MOTION_BLUR_MAX_REACH = 200
export const MOTION_BLUR_MAX_TAPS = 32
/** Golden angle, radians: rotates the disc taps. */
export const MOTION_BLUR_GOLDEN_ANGLE = 2.399963229728653
/** 1/phi: low-discrepancy sequence that sets each tap's disc radius. */
export const MOTION_BLUR_GOLDEN_RATIO = 0.6180339887498949

/**
 * Per-pixel travel in STAGE px per frame: the translation vector and the
 * isotropic term for a box of `box` size (stage px). Pure.
 */
export function motionBlurTravel(
  p: EffectParams,
  box: { width: number; height: number },
): { x: number; y: number; spread: number } {
  if (p.auto === false) {
    const length = Math.max(0, num(p, 'length', 0))
    const angle = (num(p, 'angle', 0) * Math.PI) / 180
    return { x: length * Math.cos(angle), y: length * Math.sin(angle), spread: 0 }
  }
  const half = Math.hypot(box.width, box.height) / 2
  return {
    x: num(p, MOTION_BLUR_INPUTS.x, 0),
    y: num(p, MOTION_BLUR_INPUTS.y, 0),
    spread: half * Math.hypot(num(p, MOTION_BLUR_INPUTS.spin, 0), num(p, MOTION_BLUR_INPUTS.zoom, 0)),
  }
}

/**
 * CPU twin of the shader's tap `i` of `n`: `line` in -0.5..0.5 of the streak,
 * and a disc offset of `radius` (0..1 of the disc) at `angle`. The shader uses
 * the same constants and formulas, so this is what the parity test pins.
 */
export function motionBlurTap(i: number, n: number): { line: number; radius: number; angle: number } {
  const f = (i + 0.5) / n
  const g = (i + 0.5) * MOTION_BLUR_GOLDEN_RATIO
  return { line: f - 0.5, radius: Math.sqrt(g - Math.floor(g)), angle: i * MOTION_BLUR_GOLDEN_ANGLE }
}

export const motionBlur: GpuEffect = {
  kind: 'motionBlur',
  frag: EFFECT_FRAG_HEADER + /* glsl */ `
uniform vec2 uExtent;   // uv: full streak, centred on the pixel
uniform vec2 uSpread;   // uv: isotropic disc radius per axis
uniform float uSamples;

void main() {
  int n = int(uSamples + 0.5);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < ${MOTION_BLUR_MAX_TAPS}; i++) {
    if (i >= n) break;
    float fi = float(i);
    float f = (fi + 0.5) / float(n);
    float g = (fi + 0.5) * ${MOTION_BLUR_GOLDEN_RATIO};
    float a = fi * ${MOTION_BLUR_GOLDEN_ANGLE};
    vec2 disc = uSpread * sqrt(g - floor(g)) * vec2(cos(a), sin(a));
    acc += texture(uTex, vUv + uExtent * (f - 0.5) + disc);
  }
  fragColor = acc / float(max(n, 1));
}
`,
  passes: () => 1,
  padding: () => MOTION_BLUR_MAX_REACH,
  skip: (p, box) => {
    if (num(p, 'shutter', 0) <= 0) return true
    const t = motionBlurTravel(p, box)
    const travel = Math.hypot(t.x, t.y) + t.spread
    return travel <= 0 || travel < num(p, 'minPx', 0)
  },
  uniforms: (p, env: EffectEnv) => {
    const [kx, ky] = env.pxPerStagePx
    const box = {
      width: kx > 0 ? (env.inner[2] * env.size[0]) / kx : 0,
      height: ky > 0 ? (env.inner[3] * env.size[1]) / ky : 0,
    }
    const t = motionBlurTravel(p, box)
    const shutter = Math.min(1, Math.max(0, num(p, 'shutter', 0)))
    let ex = t.x * shutter
    let ey = t.y * shutter
    let spread = t.spread * shutter
    const reach = Math.hypot(ex, ey) / 2 + spread
    if (reach > MOTION_BLUR_MAX_REACH) {
      const s = MOTION_BLUR_MAX_REACH / reach
      ex *= s
      ey *= s
      spread *= s
    }
    const samples = Math.min(MOTION_BLUR_MAX_TAPS, Math.max(4, Math.round(num(p, 'samples', 12))))
    return {
      // -ey: texture v is up, stage y is down (see the header).
      uExtent: [(ex * kx) / env.size[0], -(ey * ky) / env.size[1]],
      uSpread: [(spread * kx) / env.size[0], (spread * ky) / env.size[1]],
      uSamples: samples,
    }
  },
}
