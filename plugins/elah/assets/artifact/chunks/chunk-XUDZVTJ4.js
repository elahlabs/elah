var e=`#version 300 es
precision mediump float;

uniform sampler2D uTexture;
uniform float uOpacity;
uniform vec2 uRadius;

in vec2 vTexCoord;
in vec2 vQuadUv;
out vec4 fragColor;

void main() {
  vec4 texel = texture(uTexture, vTexCoord);
  float mask = 1.0;
  if (uRadius.x > 0.0 && uRadius.y > 0.0) {
    // Rounded-box SDF in quad-uv space (centre at 0.5,0.5, half-extent 0.5).
    vec2 r = min(uRadius, vec2(0.5));
    vec2 p = abs(vQuadUv - 0.5) - (0.5 - r);
    float d = length(max(p, 0.0) / r) - 1.0;
    float aa = length(fwidth(vQuadUv) / r);
    mask = 1.0 - smoothstep(-aa, aa, d);
  }
  fragColor = vec4(texel.rgb * uOpacity * mask, texel.a * uOpacity * mask);
}
`;export{e as a};
