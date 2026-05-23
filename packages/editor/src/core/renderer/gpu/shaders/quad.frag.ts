/**
 * Fragment shader for the textured quad.
 *
 * Samples a 2D texture and multiplies by an opacity uniform to produce the
 * final RGBA output. Used by VideoLayer (and future ImageLayer, TextLayer).
 *
 * Uniforms:
 *   uTexture — sampler2D bound to texture unit 0.
 *   uOpacity — float [0..1] composited via premultiplied alpha.
 */
export const QUAD_FRAG_SRC = /* glsl */ `#version 300 es
precision mediump float;

uniform sampler2D uTexture;
uniform float uOpacity;

in vec2 vTexCoord;
out vec4 fragColor;

void main() {
  vec4 texel = texture(uTexture, vTexCoord);
  fragColor = vec4(texel.rgb * uOpacity, texel.a * uOpacity);
}
`
