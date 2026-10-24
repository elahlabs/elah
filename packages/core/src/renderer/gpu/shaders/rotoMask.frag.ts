/**
 * Fragment shader for roto review masks (RotoMaskLayer).
 *
 * The mask texture is a grayscale PNG decoded to RGBA; `.r` is coverage
 * (0 = outside the subject, 1 = inside; soft mattes land in between).
 *
 * Modes (uMode):
 *   0 overlay — tint the subject: premultiplied `uColor * m * uOpacity`, so
 *               the video shows through everywhere else.
 *   1 matte   — the raw matte, opaque: white subject on black, exactly what
 *               the exported PNG sequence contains.
 *
 * Output is premultiplied to match the blend func WebGLContext sets.
 * Shares QUAD_VERT_SRC, so uTransform/uCrop place it on the video's box.
 */
export const ROTO_MASK_FRAG_SRC = /* glsl */ `#version 300 es
precision mediump float;

in vec2 vTexCoord;
in vec2 vQuadUv;

uniform sampler2D uTexture;
uniform int uMode;
uniform vec4 uColor;
uniform float uOpacity;

out vec4 fragColor;

void main() {
  float m = clamp(texture(uTexture, vTexCoord).r, 0.0, 1.0);
  if (uMode == 1) {
    fragColor = vec4(vec3(m) * uOpacity, uOpacity);
  } else {
    float a = m * uOpacity;
    fragColor = vec4(uColor.rgb * a, a);
  }
}
`
