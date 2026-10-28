var c=class s{program;uniformCache=new Map;constructor(e){this.program=e}static create(e,o,t){let r=s.compileShader(e,e.VERTEX_SHADER,o),i=s.compileShader(e,e.FRAGMENT_SHADER,t),n=e.createProgram();if(!n)throw new Error("ShaderProgram: gl.createProgram() returned null");if(e.attachShader(n,r),e.attachShader(n,i),e.linkProgram(n),e.detachShader(n,r),e.detachShader(n,i),e.deleteShader(r),e.deleteShader(i),!e.getProgramParameter(n,e.LINK_STATUS)){let a=e.getProgramInfoLog(n)??"(no log)";throw e.deleteProgram(n),new Error(`ShaderProgram: link failed \u2014 ${a}`)}return new s(n)}use(e){e.useProgram(this.program)}setUniform1i(e,o,t){let r=this.getUniformLocation(e,o);r!==null&&e.uniform1i(r,t)}setUniform1f(e,o,t){let r=this.getUniformLocation(e,o);r!==null&&e.uniform1f(r,t)}setUniform2f(e,o,t,r){let i=this.getUniformLocation(e,o);i!==null&&e.uniform2f(i,t,r)}setUniform3f(e,o,t,r,i){let n=this.getUniformLocation(e,o);n!==null&&e.uniform3f(n,t,r,i)}setUniform4f(e,o,t,r,i,n){let a=this.getUniformLocation(e,o);a!==null&&e.uniform4f(a,t,r,i,n)}setUniformMatrix3fv(e,o,t,r){let i=this.getUniformLocation(e,o);i!==null&&e.uniformMatrix3fv(i,t,r)}dispose(e){e.deleteProgram(this.program),this.uniformCache.clear()}getUniformLocation(e,o){if(this.uniformCache.has(o))return this.uniformCache.get(o)??null;let t=e.getUniformLocation(this.program,o);return this.uniformCache.set(o,t),t}static compileShader(e,o,t){let r=e.createShader(o);if(!r)throw new Error(`ShaderProgram: gl.createShader(${o}) returned null`);if(e.shaderSource(r,t),e.compileShader(r),!e.getShaderParameter(r,e.COMPILE_STATUS)){let i=e.getShaderInfoLog(r)??"(no log)";e.deleteShader(r);let n=o===e.VERTEX_SHADER?"vertex":"fragment";throw new Error(`ShaderProgram: ${n} shader compile failed \u2014 ${i}`)}return r}};var m=`#version 300 es
precision highp float;

// Positions for a unit quad in normalized stage space (0..1, origin top-left).
// Laid out for TRIANGLE_STRIP: TL, BL, TR, BR.
const vec2 POSITIONS[4] = vec2[4](
  vec2(0.0, 0.0),
  vec2(0.0, 1.0),
  vec2(1.0, 0.0),
  vec2(1.0, 1.0)
);

// 3\xD73 column-major transform: maps normalized stage coords \u2192 clip space.
// Built by the CPU from the clip's Transform + stage/viewport geometry.
uniform mat3 uTransform;
uniform vec4 uCrop;
uniform int uRotation;

out vec2 vTexCoord;
out vec2 vQuadUv;

void main() {
  vec2 pos = POSITIONS[gl_VertexID];
  vQuadUv = vec2(pos.x, 1.0 - pos.y); // flip Y for GL texture convention

  vec4 crop = uCrop.z > 0.0 ? uCrop : vec4(0.0, 0.0, 1.0, 1.0);
  // Point in display space (top-left origin), then into the raw frame.
  vec2 d = vec2(crop.x + pos.x * crop.z, crop.y + pos.y * crop.w);
  vec2 s = d;
  if (uRotation == 90) s = vec2(d.y, 1.0 - d.x);
  else if (uRotation == 180) s = vec2(1.0 - d.x, 1.0 - d.y);
  else if (uRotation == 270) s = vec2(1.0 - d.y, d.x);
  vTexCoord = vec2(s.x, 1.0 - s.y);

  // Homogeneous multiply, then convert to clip space: stage Y is top-down,
  // GL NDC is bottom-up, so we negate the Y component produced by the matrix.
  // MOT-8 phase B: the matrix's third row is w. It is exactly (0, 0, 1) for every flat clip, so
  // w = 1.0 and this is the old output bit for bit; a tilted clip (rotateX / rotateY) carries its
  // perspective divide there, and the GPU interpolates vTexCoord / vQuadUv perspective-correctly
  // and clips the part of the quad that would pass behind the eye (w <= 0).
  vec3 ndc = uTransform * vec3(pos, 1.0);
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, ndc.z);
}
`;export{c as a,m as b};
