/**
 * Vertex shader for effect passes: a full-target quad with `vUv` in 0..1
 * (GL orientation, y up). Drawn as TRIANGLE_STRIP with 4 vertices and no
 * attributes, like quad.vert.
 */
export const EFFECT_VERT_SRC = /* glsl */ `#version 300 es
precision highp float;

const vec2 POSITIONS[4] = vec2[4](
  vec2(-1.0, -1.0),
  vec2(-1.0, 1.0),
  vec2(1.0, -1.0),
  vec2(1.0, 1.0)
);

out vec2 vUv;

void main() {
  vec2 p = POSITIONS[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`
