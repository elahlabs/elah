import{c as F}from"./chunk-VLCTS3FQ.js";import{b as W,c as z,d as V}from"./chunk-TQ6PDCQM.js";import{e as N,f as k}from"./chunk-Q7DQOICG.js";import{a as L,b as O}from"./chunk-PNUQ6HLD.js";import"./chunk-7SZRL6FY.js";function U(t){if(typeof t!="string"||!/^#[0-9a-fA-F]{6}$/.test(t))return[0,0,0];let e=parseInt(t.slice(1),16);return[(e>>16&255)/255,(e>>8&255)/255,(e&255)/255]}function a(t,e,o=0){let r=t[e];return typeof r=="number"&&Number.isFinite(r)?r:o}function A(t){let e=t.inner[2]*t.size[0],o=t.inner[3]*t.size[1];return o>0?e/o:1}var d=`#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uTexel;
uniform vec4 uInner;
uniform float uTime;

in vec2 vUv;
out vec4 fragColor;

// uv -> 0..1 inside the clip's own box (the chain pads around it).
vec2 boxUv(vec2 uv) { return (uv - uInner.xy) / uInner.zw; }

float inBox(vec2 uv) {
  vec2 b = boxUv(uv);
  return step(0.0, b.x) * step(b.x, 1.0) * step(0.0, b.y) * step(b.y, 1.0);
}

vec3 unpremul(vec4 c) { return c.a > 0.0 ? c.rgb / c.a : vec3(0.0); }
`;var H={kind:"chromaticAberration",frag:d+`
uniform float uAmount;

void main() {
  vec2 c = uInner.xy + uInner.zw * 0.5;
  vec2 d = vUv - c;
  vec4 r = texture(uTex, c + d * (1.0 + uAmount));
  vec4 g = texture(uTex, vUv);
  vec4 b = texture(uTex, c + d * (1.0 - uAmount));
  fragColor = vec4(r.r, g.g, b.b, max(max(r.a, g.a), b.a));
}
`,passes:()=>1,padding:(t,e)=>a(t,"amount",0)*Math.max(e.width,e.height)/2,uniforms:t=>({uAmount:a(t,"amount",0)})};var K={kind:"colorGrade",frag:d+`
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
`,passes:()=>1,uniforms:t=>({uExposure:a(t,"exposure",0),uContrast:a(t,"contrast",1),uSaturation:a(t,"saturation",1),uBalance:[a(t,"temperature",0),a(t,"tint",0)],uHue:a(t,"hue",0)*Math.PI/180,uLiftGammaGain:[a(t,"lift",0),Math.max(.01,a(t,"gamma",1)),a(t,"gain",1)]})};var B=32,Y={kind:"gaussianBlur",frag:d+`
uniform vec2 uDir;
uniform float uSigma;

void main() {
  if (uSigma < 0.01) { fragColor = texture(uTex, vUv); return; }
  float reach = ceil(uSigma * 3.0);
  float stride = max(1.0, reach / ${B}.0);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -${B}; i <= ${B}; i++) {
    float x = float(i) * stride;
    if (abs(x) > reach) continue;
    float w = exp(-0.5 * x * x / (uSigma * uSigma));
    acc += texture(uTex, vUv + uDir * uTexel * x) * w;
    wsum += w;
  }
  fragColor = acc / wsum;
}
`,passes:()=>2,padding:t=>a(t,"radius",0)*1.5,uniforms:(t,e)=>{let o=a(t,"radius",0),r=e.pass===0,i=r?e.pxPerStagePx[0]:e.pxPerStagePx[1];return{uDir:r?[1,0]:[0,1],uSigma:o*i/2}}};var $={kind:"grain",frag:d+`
uniform float uAmount;
uniform float uCell;     // chain px per grain cell
uniform float uSeed;     // seed + frame when animated

float hash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec4 s = texture(uTex, vUv);
  vec2 cell = floor(gl_FragCoord.xy / uCell);
  float n = hash(vec3(cell, mod(uSeed, 4096.0))) - 0.5;
  vec3 c = clamp(s.rgb + n * uAmount * 0.5 * s.a, 0.0, s.a);
  fragColor = vec4(c, s.a);
}
`,passes:()=>1,uniforms:(t,e)=>{let o=(e.pxPerStagePx[0]+e.pxPerStagePx[1])/2,r=t.animated!==!1;return{uAmount:a(t,"amount",0),uCell:Math.max(.5,a(t,"size",1.5)*o),uSeed:a(t,"seed",0)+(r?e.frame:0)}}};function ke(t,e){return!(t>0)||!(e>0)||t<=e?0:(1-e/t)/2}var j={kind:"letterbox",frag:d+`
uniform float uBar;     // fraction of box height, each side
uniform vec3 uColor;

void main() {
  vec4 s = texture(uTex, vUv);
  vec2 b = boxUv(vUv);
  float bar = inBox(vUv) * (step(b.y, uBar) + step(1.0 - uBar, b.y));
  fragColor = bar > 0.0 && uBar > 0.0 ? vec4(uColor, 1.0) : s;
}
`,passes:()=>1,uniforms:(t,e)=>({uBar:ke(a(t,"ratio",2.39),A(e)),uColor:U(t.color)})};var Q={kind:"rgbSplit",frag:d+`
uniform vec2 uOffset;   // uv

void main() {
  vec4 r = texture(uTex, vUv + uOffset);
  vec4 g = texture(uTex, vUv);
  vec4 b = texture(uTex, vUv - uOffset);
  fragColor = vec4(r.r, g.g, b.b, max(max(r.a, g.a), b.a));
}
`,passes:()=>1,padding:(t,e)=>a(t,"amount",0)*e.width,uniforms:(t,e)=>{let o=a(t,"amount",0),r=a(t,"angle",0)*Math.PI/180,i=o*e.inner[2]*e.size[0];return{uOffset:[i*Math.cos(r)/e.size[0],i*Math.sin(r)/e.size[1]]}}};var J={kind:"scanlines",frag:d+`
uniform float uDensity;
uniform float uIntensity;
uniform float uSpeed;

void main() {
  vec4 s = texture(uTex, vUv);
  float phase = boxUv(vUv).y * uDensity + uTime * uSpeed;
  float f = 1.0 - uIntensity * (0.5 + 0.5 * cos(6.28318531 * phase));
  fragColor = vec4(s.rgb * f, s.a);
}
`,passes:()=>1,uniforms:t=>({uDensity:a(t,"density",480),uIntensity:a(t,"intensity",0),uSpeed:a(t,"speed",0)})};var Z={kind:"vignette",frag:d+`
uniform float uAmount;
uniform float uRadius;
uniform float uSoftness;
uniform vec3 uColor;

void main() {
  vec4 s = texture(uTex, vUv);
  vec2 b = boxUv(vUv) - 0.5;
  float d = length(b * 2.0) / 1.41421356;
  float f = smoothstep(uRadius - uSoftness, uRadius, d) * uAmount;
  fragColor = vec4(mix(s.rgb, uColor * s.a, f), s.a);
}
`,passes:()=>1,uniforms:t=>({uAmount:a(t,"amount",0),uRadius:a(t,"radius",.75),uSoftness:Math.max(.01,a(t,"softness",.45)),uColor:U(t.color)})};function q(t,e,o="radius",r=24){let i=Math.max(0,a(t,o,r));return[i*e.pxPerStagePx[0]/e.size[0],i*e.pxPerStagePx[1]/e.size[1]]}var ee=`
const int TAPS = 32;
// Golden-angle disc tap i in 0..TAPS-1 \u2192 offset in unit disc, and its weight.
vec2 discTap(int i, out float w) {
  float fi = float(i) + 0.5;
  float r = sqrt(fi / float(TAPS));
  float a = fi * 2.39996323;
  w = 1.0 - r * 0.6;
  return vec2(cos(a), sin(a)) * r;
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`,te={kind:"bloom",frag:d+ee+`
uniform float uThreshold;
uniform float uIntensity;
uniform vec2 uRadius;
uniform vec3 uTint;

void main() {
  vec4 s = texture(uTex, vUv);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < TAPS; i++) {
    float w;
    vec2 o = discTap(i, w) * uRadius;
    vec4 c = texture(uTex, vUv + o);
    vec3 u = unpremul(c);
    float k = smoothstep(uThreshold, uThreshold + 0.2, luma(u)) * c.a;
    acc += u * k * w;
    wsum += w;
  }
  vec3 add = acc / wsum * uIntensity * uTint;
  float a = clamp(max(s.a, max(add.r, max(add.g, add.b))), 0.0, 1.0);
  fragColor = vec4(min(s.rgb + add, vec3(a)), a);
}
`,passes:()=>1,padding:t=>a(t,"radius",24),uniforms:(t,e)=>({uThreshold:a(t,"threshold",.7),uIntensity:a(t,"intensity",.8),uRadius:q(t,e),uTint:U(t.tint)})},re={kind:"glow",frag:d+ee+`
uniform float uIntensity;
uniform vec2 uRadius;
uniform vec3 uColor;

void main() {
  vec4 s = texture(uTex, vUv);
  float acc = 0.0;
  float wsum = 0.0;
  for (int i = 0; i < TAPS; i++) {
    float w;
    vec2 o = discTap(i, w) * uRadius;
    acc += texture(uTex, vUv + o).a * w;
    wsum += w;
  }
  float g = clamp(acc / wsum * uIntensity, 0.0, 1.0);
  fragColor = s + vec4(uColor * g, g) * (1.0 - s.a);
}
`,passes:()=>1,padding:t=>a(t,"radius",24),uniforms:(t,e)=>({uIntensity:a(t,"intensity",1.5),uRadius:q(t,e),uColor:U(t.color)})},oe={kind:"flash",frag:d+`
uniform float uAmount;
uniform vec3 uColor;

void main() {
  vec4 s = texture(uTex, vUv);
  fragColor = vec4(mix(s.rgb, uColor * s.a, uAmount), s.a);
}
`,passes:()=>1,uniforms:t=>({uAmount:a(t,"amount",.8),uColor:U(t.color)})},ae={kind:"strobe",frag:d+`
uniform float uRate;
uniform float uDuty;
uniform float uAmount;
uniform vec3 uColor;

void main() {
  vec4 s = texture(uTex, vUv);
  float on = step(fract(uTime * uRate), uDuty);
  fragColor = vec4(mix(s.rgb, uColor * s.a, on * uAmount), s.a);
}
`,passes:()=>1,uniforms:t=>({uRate:a(t,"rate",8),uDuty:a(t,"duty",.5),uAmount:a(t,"amount",.8),uColor:t.mode==="black"?[0,0,0]:[1,1,1]})},ne={kind:"lightRays",frag:d+`
uniform vec2 uCenter;     // box uv
uniform float uLength;
uniform float uIntensity;
uniform float uThreshold;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec4 s = texture(uTex, vUv);
  vec2 b = boxUv(vUv);
  vec3 acc = vec3(0.0);
  float decay = 1.0;
  float wsum = 0.0;
  for (int i = 0; i < 40; i++) {
    float t = float(i) / 40.0;
    vec2 pb = mix(b, uCenter, t * uLength);
    vec4 c = texture(uTex, uInner.xy + pb * uInner.zw);
    vec3 u = unpremul(c);
    acc += u * smoothstep(uThreshold, uThreshold + 0.2, luma(u)) * c.a * decay;
    wsum += decay;
    decay *= 0.96;
  }
  vec3 add = acc / wsum * uIntensity;
  float a = clamp(max(s.a, max(add.r, max(add.g, add.b))), 0.0, 1.0);
  fragColor = vec4(min(s.rgb + add, vec3(a)), a);
}
`,passes:()=>1,uniforms:t=>({uCenter:[a(t,"centerX",.5),1-a(t,"centerY",.2)],uLength:a(t,"length",.6),uIntensity:a(t,"intensity",1),uThreshold:a(t,"threshold",.6)})};var w=`
uniform float uAspect;   // box width / height
vec4 sampleBox(vec2 b) {
  vec2 inside = step(vec2(0.0), b) * step(b, vec2(1.0));
  return texture(uTex, uInner.xy + b * uInner.zw) * inside.x * inside.y;
}
// Box uv -> aspect-corrected space (x scaled by aspect) and back.
vec2 toRound(vec2 b) { return vec2(b.x * uAspect, b.y); }
vec2 fromRound(vec2 r) { return vec2(r.x / uAspect, r.y); }
`,ie={kind:"wave",frag:d+w+`
uniform float uAmplitude;
uniform float uFrequency;
uniform float uSpeed;
uniform float uVertical;

void main() {
  vec2 b = boxUv(vUv);
  float phase = 6.2831853 * (uFrequency * (uVertical > 0.5 ? b.x : b.y) + uSpeed * uTime);
  vec2 o = uVertical > 0.5 ? vec2(0.0, uAmplitude * sin(phase)) : vec2(uAmplitude * sin(phase), 0.0);
  fragColor = sampleBox(b + o);
}
`,passes:()=>1,padding:(t,e)=>a(t,"amplitude",.02)*Math.max(e.width,e.height),uniforms:(t,e)=>({uAspect:A(e),uAmplitude:a(t,"amplitude",.02),uFrequency:a(t,"frequency",6),uSpeed:a(t,"speed",1),uVertical:t.direction==="vertical"?1:0})},ue={kind:"twirl",frag:d+w+`
uniform float uAngle;    // radians at the centre
uniform float uRadius;   // fraction of the box height
uniform vec2 uCenter;    // box uv

void main() {
  vec2 b = boxUv(vUv);
  vec2 d = toRound(b) - toRound(uCenter);
  float r = length(d);
  if (r < uRadius) {
    float k = 1.0 - r / uRadius;
    float a = uAngle * k * k;
    float c = cos(a), s = sin(a);
    d = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
  }
  fragColor = sampleBox(fromRound(toRound(uCenter) + d));
}
`,passes:()=>1,uniforms:(t,e)=>({uAspect:A(e),uAngle:a(t,"angle",180)*Math.PI/180,uRadius:Math.max(.001,a(t,"radius",.5)),uCenter:[a(t,"centerX",.5),1-a(t,"centerY",.5)]})},se={kind:"bulge",frag:d+w+`
uniform float uAmount;
uniform float uRadius;
uniform vec2 uCenter;

void main() {
  vec2 b = boxUv(vUv);
  vec2 d = toRound(b) - toRound(uCenter);
  float r = length(d);
  if (r < uRadius && r > 0.0) {
    float n = r / uRadius;
    d = d / r * uRadius * pow(n, 1.0 + uAmount);
  }
  fragColor = sampleBox(fromRound(toRound(uCenter) + d));
}
`,passes:()=>1,uniforms:(t,e)=>({uAspect:A(e),uAmount:a(t,"amount",.5),uRadius:Math.max(.001,a(t,"radius",.4)),uCenter:[a(t,"centerX",.5),1-a(t,"centerY",.5)]})},ce={kind:"fisheye",frag:d+w+`
uniform float uAmount;

void main() {
  vec2 b = boxUv(vUv);
  vec2 d = b - 0.5;
  float r2 = min(0.5, dot(d, d));
  float f = 1.0 - uAmount * (0.5 - r2);
  fragColor = sampleBox(0.5 + d * f);
}
`,passes:()=>1,uniforms:(t,e)=>({uAspect:A(e),uAmount:a(t,"amount",.5)})},D=`
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
`,fe={kind:"displace",frag:d+w+D+`
uniform float uAmount;
uniform float uScale;
uniform float uSpeed;
uniform float uSeed;

void main() {
  vec2 b = boxUv(vUv);
  vec2 p = toRound(b) * uScale + vec2(uSeed * 17.0, uSeed * 31.0) + uTime * uSpeed;
  vec2 o = vec2(vnoise(p) - 0.5, vnoise(p + 91.7) - 0.5) * uAmount;
  fragColor = sampleBox(b + o);
}
`,passes:()=>1,padding:(t,e)=>a(t,"amount",.03)*.5*Math.max(e.width,e.height),uniforms:(t,e)=>({uAspect:A(e),uAmount:a(t,"amount",.03),uScale:a(t,"scale",6),uSpeed:a(t,"speed",.5),uSeed:a(t,"seed",3)})};var P=`
vec4 sampleBox(vec2 b) {
  vec2 inside = step(vec2(0.0), b) * step(b, vec2(1.0));
  return texture(uTex, uInner.xy + b * uInner.zw) * inside.x * inside.y;
}
`,me={kind:"vhs",frag:d+P+D+`
uniform float uAmount;
uniform float uFrame;

void main() {
  vec2 b = boxUv(vUv);
  float line = floor(b.y * 240.0);
  // Horizontal tape jitter per line, plus a slow wobble.
  float jitter = (hash21(vec2(line, uFrame)) - 0.5) * 0.004 + sin(b.y * 12.0 + uTime * 2.0) * 0.0015;
  // A tracking band that rolls up the frame.
  float band = smoothstep(0.0, 0.02, abs(fract(b.y + uTime * 0.07) - 0.5) - 0.46);
  vec2 bj = b + vec2((jitter + (1.0 - band) * 0.01) * uAmount, 0.0);
  float ca = 0.004 * uAmount;
  vec4 g = sampleBox(bj);
  float r = sampleBox(bj + vec2(ca, 0.0)).r;
  float bl = sampleBox(bj - vec2(ca, 0.0)).b;
  vec3 c = vec3(r, g.g, bl);
  // Soften saturation and lift blacks like tape.
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(l), 0.25 * uAmount) + 0.03 * uAmount * g.a;
  // Snow.
  float n = hash21(gl_FragCoord.xy + uFrame * 13.0) - 0.5;
  c += n * 0.08 * uAmount * g.a;
  fragColor = vec4(clamp(c, 0.0, g.a), g.a);
}
`,passes:()=>1,padding:(t,e)=>.02*a(t,"amount",.6)*e.width,uniforms:(t,e)=>({uAmount:a(t,"amount",.6),uFrame:e.frame})},le={kind:"crt",frag:d+P+`
uniform float uCurvature;
uniform float uScanlines;
uniform float uVignette;
uniform float uMask;
uniform float uLines;

void main() {
  vec2 b = boxUv(vUv);
  vec2 d = b * 2.0 - 1.0;
  d *= 1.0 + uCurvature * (d.yx * d.yx);
  vec2 cb = (d + 1.0) * 0.5;
  vec4 s = sampleBox(cb);
  vec3 c = s.rgb;
  float sl = 0.5 + 0.5 * cos(cb.y * uLines * 6.2831853);
  c *= 1.0 - uScanlines * 0.6 * (1.0 - sl);
  float m = mod(floor(gl_FragCoord.x), 3.0);
  vec3 mask = vec3(m == 0.0 ? 1.0 : 1.0 - uMask, m == 1.0 ? 1.0 : 1.0 - uMask, m == 2.0 ? 1.0 : 1.0 - uMask);
  c *= mask;
  float v = smoothstep(1.4, 0.6, length(d));
  c *= mix(1.0, v, uVignette);
  fragColor = vec4(clamp(c, 0.0, s.a), s.a);
}
`,passes:()=>1,uniforms:(t,e)=>({uCurvature:a(t,"curvature",.12),uScanlines:a(t,"scanlines",.35),uVignette:a(t,"vignette",.35),uMask:a(t,"mask",.2),uLines:Math.max(40,e.inner[3]*e.size[1]/3)})},de={kind:"pixelate",frag:d+P+`
uniform vec2 uCells;   // cells across the box, per axis

void main() {
  vec2 b = boxUv(vUv);
  vec2 q = (floor(b * uCells) + 0.5) / uCells;
  fragColor = sampleBox(q) * inBox(vUv);
}
`,passes:()=>1,uniforms:(t,e)=>{let o=Math.max(1,a(t,"size",12)),r=e.inner[2]*e.size[0]/e.pxPerStagePx[0],i=e.inner[3]*e.size[1]/e.pxPerStagePx[1];return{uCells:[Math.max(1,r/o),Math.max(1,i/o)]}}},pe={kind:"glitchBlocks",frag:d+P+D+`
uniform float uAmount;
uniform float uBlock;
uniform float uTick;
uniform float uSeed;

void main() {
  vec2 b = boxUv(vUv);
  vec2 cell = floor(vec2(b.x / (uBlock * 4.0), b.y / uBlock));
  float h = hash21(cell + vec2(uTick * 7.13, uSeed));
  float on = step(1.0 - uAmount * 0.35, h);
  float shift = (hash21(cell.yy + uTick + uSeed * 3.1) - 0.5) * 0.15 * on;
  vec2 bs = b + vec2(shift, 0.0);
  vec4 g = sampleBox(bs);
  float r = sampleBox(bs + vec2(0.01 * on, 0.0)).r;
  float bl = sampleBox(bs - vec2(0.01 * on, 0.0)).b;
  fragColor = vec4(min(vec3(r, g.g, bl), vec3(g.a)), g.a);
}
`,passes:()=>1,padding:(t,e)=>.08*e.width,uniforms:(t,e)=>({uAmount:a(t,"amount",.5),uBlock:Math.max(.01,a(t,"blockSize",.06)),uTick:Math.floor(e.time*a(t,"speed",8)),uSeed:a(t,"seed",5)})};var X=200,ve=32,De=2.399963229728653,Pe=.6180339887498949;function he(t,e){if(t.auto===!1){let r=Math.max(0,a(t,"length",0)),i=a(t,"angle",0)*Math.PI/180;return{x:r*Math.cos(i),y:r*Math.sin(i),spread:0}}let o=Math.hypot(e.width,e.height)/2;return{x:a(t,F.x,0),y:a(t,F.y,0),spread:o*Math.hypot(a(t,F.spin,0),a(t,F.zoom,0))}}var xe={kind:"motionBlur",frag:d+`
uniform vec2 uExtent;   // uv: full streak, centred on the pixel
uniform vec2 uSpread;   // uv: isotropic disc radius per axis
uniform float uSamples;

void main() {
  int n = int(uSamples + 0.5);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < ${ve}; i++) {
    if (i >= n) break;
    float fi = float(i);
    float f = (fi + 0.5) / float(n);
    float g = (fi + 0.5) * ${Pe};
    float a = fi * ${De};
    vec2 disc = uSpread * sqrt(g - floor(g)) * vec2(cos(a), sin(a));
    acc += texture(uTex, vUv + uExtent * (f - 0.5) + disc);
  }
  fragColor = acc / float(max(n, 1));
}
`,passes:()=>1,padding:()=>X,skip:(t,e)=>{if(a(t,"shutter",0)<=0)return!0;let o=he(t,e),r=Math.hypot(o.x,o.y)+o.spread;return r<=0||r<a(t,"minPx",0)},uniforms:(t,e)=>{let[o,r]=e.pxPerStagePx,i={width:o>0?e.inner[2]*e.size[0]/o:0,height:r>0?e.inner[3]*e.size[1]/r:0},n=he(t,i),c=Math.min(1,Math.max(0,a(t,"shutter",0))),f=n.x*c,s=n.y*c,m=n.spread*c,p=Math.hypot(f,s)/2+m;if(p>X){let l=X/p;f*=l,s*=l,m*=l}let u=Math.min(ve,Math.max(4,Math.round(a(t,"samples",12))));return{uExtent:[f*o/e.size[0],-(s*r)/e.size[1]],uSpread:[m*o/e.size[0],m*r/e.size[1]],uSamples:u}}};var be=new Map([K,Y,Z,$,Q,j,H,J,te,re,oe,ae,ne,ie,ue,se,ce,fe,me,le,de,pe,xe].map(t=>[t.kind,t]));var S=class{_maxLive;_maxFree;_free=[];_inUse=new Set;constructor(e={}){this._maxLive=Math.max(2,e.maxLive??8),this._maxFree=Math.max(0,e.maxFree??6)}acquire(e,o,r){let i=Math.max(1,Math.round(o)),n=Math.max(1,Math.round(r)),c=this._free.findIndex(s=>s.width===i&&s.height===n);if(c>=0){let[s]=this._free.splice(c,1);return this._inUse.add(s),s}for(;this.liveCount>=this._maxLive&&this._free.length>0;)this._destroy(e,this._free.shift());if(this.liveCount>=this._maxLive)return null;let f=this._create(e,i,n);return f&&this._inUse.add(f),f}release(e,o){if(this._inUse.delete(o))for(this._free.push(o);this._free.length>this._maxFree;)this._destroy(e,this._free.shift())}dispose(e){for(let o of this._free)this._destroy(e,o);for(let o of this._inUse)this._destroy(e,o);this._free.length=0,this._inUse.clear()}notifyContextLost(){this._free.length=0,this._inUse.clear()}get liveCount(){return this._free.length+this._inUse.size}get freeCount(){return this._free.length}_create(e,o,r){let i=e.createTexture(),n=e.createFramebuffer();if(!i||!n)return i&&e.deleteTexture(i),n&&e.deleteFramebuffer(n),null;let c=e.getParameter(e.TEXTURE_BINDING_2D);e.bindTexture(e.TEXTURE_2D,i),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,o,r,0,e.RGBA,e.UNSIGNED_BYTE,null),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.bindTexture(e.TEXTURE_2D,c??null);let f=e.getParameter(e.FRAMEBUFFER_BINDING);e.bindFramebuffer(e.FRAMEBUFFER,n),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,i,0);let s=e.checkFramebufferStatus(e.FRAMEBUFFER)===e.FRAMEBUFFER_COMPLETE;return e.bindFramebuffer(e.FRAMEBUFFER,f??null),s?{fbo:n,texture:i,width:o,height:r}:(e.deleteFramebuffer(n),e.deleteTexture(i),null)}_destroy(e,o){e.deleteFramebuffer(o.fbo),e.deleteTexture(o.texture)}};var G=`#version 300 es
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
`;var Ee=d+`
uniform int uKind;          // 0 rect, 1 ellipse, 2 gradient, 3 path
uniform sampler2D uPath;    // rasterised path, covering the mask box
uniform vec2 uBoxPx;        // clip box size, chain px
uniform vec2 uCenter;       // mask centre, box px from top-left (y down)
uniform vec2 uHalf;         // mask half size, box px
uniform float uRotation;    // radians, clockwise on screen
uniform float uFeather;     // px
uniform float uAngle;       // gradient direction, radians
uniform float uInvert;      // 0 or 1

void main() {
  vec4 s = texture(uTex, vUv);
  vec2 b = boxUv(vUv);
  vec2 p = vec2(b.x, 1.0 - b.y) * uBoxPx - uCenter;
  float c = cos(uRotation), sn = sin(uRotation);
  vec2 q = vec2(c * p.x + sn * p.y, -sn * p.x + c * p.y);
  vec2 h = max(uHalf, vec2(0.0001));
  float a;
  if (uKind == 3) {
    // Mask-local, y down, 0..1 across the box; the raster was uploaded
    // flipped, so v = 1 is its top row.
    vec2 m = q / (2.0 * h) + 0.5;
    float inside = step(0.0, m.x) * step(m.x, 1.0) * step(0.0, m.y) * step(m.y, 1.0);
    a = inside * texture(uPath, vec2(m.x, 1.0 - m.y)).a;
  } else if (uKind == 2) {
    vec2 dir = vec2(cos(uAngle), sin(uAngle));
    float reach = abs(dir.x) * h.x + abs(dir.y) * h.y;
    a = clamp(0.5 - 0.5 * dot(q, dir) / reach, 0.0, 1.0);
  } else {
    float d;
    if (uKind == 1) {
      d = (length(q / h) - 1.0) * min(h.x, h.y);
    } else {
      vec2 e = abs(q) - h;
      d = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
    }
    float f = max(uFeather, 1.0);
    a = clamp(0.5 - d / f, 0.0, 1.0);
  }
  a = mix(a, 1.0 - a, uInvert);
  fragColor = s * a;
}
`;function Te(t,e,o,r){let i=e[2]*o[0],n=e[3]*o[1],c=r?r.width:i,f=r?r.height:n,s=Math.abs(t.width)*c/2,m=Math.abs(t.height)*f/2,p=t.x*c+s,u=t.y*f+m,l=t.rotation??0;if(r){let v=p-c/2,_=u-f/2,h=Math.cos(r.rotation),b=Math.sin(r.rotation);p=r.x+c/2+v*h-_*b,u=r.y+f/2+v*b+_*h,l+=r.rotation}return{uKind:z[t.kind]??0,uBoxPx:[i,n],uCenter:[p,u],uHalf:[s,m],uRotation:l,uFeather:(t.feather??0)*2*Math.min(s,m),uAngle:t.angle??0,uInvert:t.invert?1:0}}var Se=1024;function _e(t,e,o){if(!t.path)return null;let r=Math.max(e,o,1),i=Math.min(1,Se/r),n=Math.max(8,Math.round(e*i)),c=Math.max(8,Math.round(o*i)),f=null;typeof OffscreenCanvas<"u"?f=new OffscreenCanvas(n,c):typeof document<"u"&&(f=document.createElement("canvas"),f.width=n,f.height=c);let s=f?.getContext("2d");if(!f||!s||typeof Path2D>"u")return null;let m=t.viewBox??{x:0,y:0,width:100,height:100};try{let p=new Path2D(t.path);s.setTransform(n/Math.max(m.width,1e-6),0,0,c/Math.max(m.height,1e-6),0,0),s.translate(-m.x,-m.y),s.fillStyle="#fff",s.fill(p)}catch{return null}return f}var Re={normal:0,add:1,screen:2,multiply:3,overlay:4,softLight:5,darken:6,lighten:7,difference:8},ge=`#version 300 es
precision highp float;

uniform sampler2D uTexture;
uniform sampler2D uBackdrop;
uniform float uOpacity;
uniform vec4 uViewport;   // x, y, w, h of the stage viewport, px
uniform int uMode;
uniform sampler2D uMatte;   // track matte, rendered at the same viewport
uniform int uMatteMode;     // 0 none, 1 alpha, 2 luma
uniform float uMatteInvert;

in vec2 vTexCoord;
in vec2 vQuadUv;
out vec4 fragColor;

vec3 softLight(vec3 cb, vec3 cs) {
  vec3 d = mix(sqrt(cb), ((16.0 * cb - 12.0) * cb + 4.0) * cb, step(cb, vec3(0.25)));
  vec3 lo = cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb);
  vec3 hi = cb + (2.0 * cs - 1.0) * (d - cb);
  return mix(hi, lo, step(cs, vec3(0.5)));
}

vec3 hardLight(vec3 cb, vec3 cs) {
  vec3 lo = cb * 2.0 * cs;
  vec3 s2 = 2.0 * cs - 1.0;
  vec3 hi = cb + s2 - cb * s2;
  return mix(hi, lo, step(cs, vec3(0.5)));
}

vec3 blendFn(vec3 cb, vec3 cs) {
  if (uMode == 2) return cb + cs - cb * cs;
  if (uMode == 3) return cb * cs;
  if (uMode == 4) return hardLight(cs, cb);
  if (uMode == 5) return softLight(cb, cs);
  if (uMode == 6) return min(cb, cs);
  if (uMode == 7) return max(cb, cs);
  if (uMode == 8) return abs(cb - cs);
  return cs;
}

void main() {
  vec2 screenUv = (gl_FragCoord.xy - uViewport.xy) / uViewport.zw;
  vec4 src = texture(uTexture, vTexCoord) * uOpacity;
  if (uMatteMode > 0) {
    vec4 m = texture(uMatte, screenUv);
    // Luma of the premultiplied matte = its luminance composited over black.
    float k = uMatteMode == 1 ? m.a : dot(m.rgb, vec3(0.2126, 0.7152, 0.0722));
    k = mix(k, 1.0 - k, uMatteInvert);
    src *= clamp(k, 0.0, 1.0);
  }
  vec4 dst = texture(uBackdrop, screenUv);
  if (uMode == 1) {
    fragColor = min(src + dst, vec4(1.0));
    return;
  }
  float as = src.a;
  float ab = dst.a;
  vec3 cs = as > 0.0 ? src.rgb / as : vec3(0.0);
  vec3 cb = ab > 0.0 ? dst.rgb / ab : vec3(0.0);
  vec3 co = src.rgb * (1.0 - ab) + dst.rgb * (1.0 - as) + as * ab * clamp(blendFn(cb, cs), 0.0, 1.0);
  fragColor = vec4(co, as + ab - as * ab);
}
`;var ye={fade:0,slide:1,wipe:2,zoom:3,spin:4,whip:5,glitchCut:6,warpDissolve:7,lumaWipe:8};function Ue(t){switch(t){case"left":return[-1,0];case"up":return[0,1];case"down":return[0,-1];default:return[1,0]}}var Ae=`#version 300 es
precision highp float;

uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float uT;
uniform int uKind;
uniform vec2 uDir;
uniform float uAspect;

in vec2 vUv;
out vec4 fragColor;

vec4 over(vec4 top, vec4 bottom) { return top + bottom * (1.0 - top.a); }

vec4 sampleIn(sampler2D tex, vec2 uv) {
  vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return texture(tex, uv) * inside.x * inside.y;
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Scale/rotate a uv about the centre, in aspect-correct space.
vec2 about(vec2 uv, float scale, float angle) {
  vec2 d = (uv - 0.5) * vec2(uAspect, 1.0);
  float c = cos(angle), s = sin(angle);
  d = vec2(c * d.x - s * d.y, s * d.x + c * d.y) / scale;
  return d / vec2(uAspect, 1.0) + 0.5;
}

void main() {
  float t = clamp(uT, 0.0, 1.0);
  vec2 uv = vUv;
  vec4 a = texture(uFrom, uv);
  vec4 b = texture(uTo, uv);

  if (uKind == 0) {
    // Cross-fade: outgoing over incoming, fading out.
    fragColor = over(a * (1.0 - t), b);
  } else if (uKind == 1) {
    // Slide: outgoing moves away along uDir, incoming revealed underneath.
    fragColor = over(sampleIn(uFrom, uv - uDir * t), b);
  } else if (uKind == 2) {
    // Wipe: outgoing keeps the left (1 - t) of the frame.
    fragColor = uv.x < 1.0 - t ? over(a, b) : b;
  } else if (uKind == 3) {
    // Zoom: push into the outgoing clip, arrive from slightly zoomed-out.
    float e = t * t * (3.0 - 2.0 * t);
    vec4 za = sampleIn(uFrom, about(uv, 1.0 + e * 1.5, 0.0));
    vec4 zb = sampleIn(uTo, about(uv, 0.7 + e * 0.3, 0.0));
    fragColor = over(za * (1.0 - e), zb * e);
  } else if (uKind == 4) {
    // Spin: rotate a quarter turn out, the incoming a quarter turn in.
    float e = t * t * (3.0 - 2.0 * t);
    vec4 sa = sampleIn(uFrom, about(uv, 1.0 - e * 0.5, e * 1.5707963));
    vec4 sb = sampleIn(uTo, about(uv, 0.5 + e * 0.5, (e - 1.0) * 1.5707963));
    fragColor = over(sa * (1.0 - e), sb * e);
  } else if (uKind == 5) {
    // Whip pan: both clips race along uDir with a directional blur; switch at the middle.
    float e = t * t * (3.0 - 2.0 * t);
    float blur = sin(t * 3.14159265) * 0.18;
    vec4 acc = vec4(0.0);
    for (int i = 0; i < 12; i++) {
      float k = (float(i) / 11.0 - 0.5) * blur;
      vec2 p = uv + uDir * k;
      vec4 wa = sampleIn(uFrom, p - uDir * e);
      vec4 wb = sampleIn(uTo, p + uDir * (1.0 - e));
      acc += over(wa, wb);
    }
    fragColor = acc / 12.0;
  } else if (uKind == 6) {
    // Glitch cut: blocks jump and tear for a few frames either side of the cut.
    float burst = 1.0 - abs(t - 0.5) * 2.0;
    float tick = floor(t * 24.0);
    vec2 cell = floor(vec2(uv.x * 6.0, uv.y * 18.0));
    float h = hash21(cell + tick * 7.13);
    float on = step(1.0 - burst * 0.6, h);
    float shift = (hash21(cell.yy + tick) - 0.5) * 0.2 * on;
    vec2 gu = uv + vec2(shift, 0.0);
    vec4 src = t < 0.5 ? texture(uFrom, gu) : texture(uTo, gu);
    float r = (t < 0.5 ? texture(uFrom, gu + vec2(0.012 * on, 0.0)) : texture(uTo, gu + vec2(0.012 * on, 0.0))).r;
    float bl = (t < 0.5 ? texture(uFrom, gu - vec2(0.012 * on, 0.0)) : texture(uTo, gu - vec2(0.012 * on, 0.0))).b;
    fragColor = vec4(min(vec3(r, src.g, bl), vec3(src.a)), src.a);
  } else if (uKind == 7) {
    // Warp dissolve: a noise threshold eats the outgoing clip, warping near the edge.
    float n = vnoise(uv * vec2(uAspect, 1.0) * 5.0) * 0.7 + vnoise(uv * vec2(uAspect, 1.0) * 17.0) * 0.3;
    float edge = smoothstep(t - 0.08, t + 0.08, n);
    vec2 warp = (vec2(vnoise(uv * 9.0 + t), vnoise(uv * 9.0 - t)) - 0.5) * 0.06 * (1.0 - abs(edge * 2.0 - 1.0));
    vec4 wa = sampleIn(uFrom, uv + warp);
    fragColor = over(wa * edge, b);
  } else {
    // Luma fade: the outgoing clip's darks go first.
    vec3 ua = a.a > 0.0 ? a.rgb / a.a : vec3(0.0);
    float l = dot(ua, vec3(0.2126, 0.7152, 0.0722));
    float keep = smoothstep(t - 0.12, t + 0.12, l * 0.85 + 0.075);
    fragColor = over(a * keep, b);
  }
}
`;var Ce=2048,Ge=256;function Ie(t,e,o,r,i){let n=Math.abs(t.width),c=Math.abs(t.height);if(!(n>0)||!(c>0))return null;let f=r?N(r):null,s=(e>0?e:n)*(f?f.width:1),m=(o>0?o:c)*(f?f.height:1),p=Math.min(s,n),u=Math.min(m,c),l=Math.max(p,u);if(l>Ce){let x=Ce/l;p*=x,u*=x}p=Math.max(1,Math.round(p)),u=Math.max(1,Math.round(u));let v=p/n,_=u/c,h=0;for(let x of i)h+=Math.max(0,x.gpu.padding?.(x.params,{width:n,height:c})??0);h=Math.min(Ge,h);let b=Math.ceil(h*v),g=Math.ceil(h*_),E=b/v,M=g/_;return{contentWidth:p,contentHeight:u,padX:b,padY:g,width:p+2*b,height:u+2*g,pxPerStagePx:[v,_],outRect:{x:t.x-E,y:t.y-M,width:t.width+2*E,height:t.height+2*M,rotation:t.rotation,...t.skewX?{skewX:t.skewX}:{},...t.skewY?{skewY:t.skewY}:{},...t.rotateX?{rotateX:t.rotateX}:{},...t.rotateY?{rotateY:t.rotateY}:{},...t.perspective?{perspective:t.perspective}:{}}}}var Me=class{_pool;_programs=new Map;_broken=new Set;_vao=null;_gl=null;_runs=0;constructor(e=new S){this._pool=e}draw(e,o){let{gl:r}=e;this._gl=r;let i=[],n={width:Math.abs(o.rect.width),height:Math.abs(o.rect.height)};for(let x of o.effects){let T=be.get(x.kind);if(!T||T.skip?.(x.params,n))continue;let y=this._program(r,T);y&&i.push({gpu:T,program:y,params:x.params})}let c=V(o.mask)?o.mask:void 0,f=o.blend&&o.blend!=="normal"?o.blend:void 0,s;if(o.matte){let x=this._mattes.get((e.keyPrefix??"")+o.matte.sourceClipId);if(x)s={texture:x.texture,mode:W[o.matte.kind],invert:o.matte.invert};else if(!o.matte.invert)return!0}if(i.length===0&&!c&&!f&&!s)return!1;let m=c?this._named(r,"__mask",G,Ee):null,p=f||s?this._named(r,"__blend",O,ge):null;if(i.length===0&&!m&&!p)return!1;let u=Ie(o.rect,o.contentWidth,o.contentHeight,o.crop,i);if(!u||!this._vao&&(this._vao=r.createVertexArray(),!this._vao))return!1;let l=this._pool.acquire(r,u.width,u.height),v=this._pool.acquire(r,u.width,u.height);if(!l||!v)return l&&this._pool.release(r,l),v&&this._pool.release(r,v),!1;let _=r.getParameter(r.FRAMEBUFFER_BINDING),h=Array.from(r.getParameter(r.VIEWPORT)),b=Array.from(r.getParameter(r.COLOR_CLEAR_VALUE));r.bindFramebuffer(r.FRAMEBUFFER,l.fbo),r.viewport(0,0,u.width,u.height),r.clearColor(0,0,0,0),r.clear(r.COLOR_BUFFER_BIT);let g=o.crop;o.program.use(r),r.bindVertexArray(o.vao),o.program.setUniform1i(r,"uTexture",o.unit),o.program.setUniform1f(r,"uOpacity",1),o.program.setUniform2f(r,"uRadius",o.cornerRadius??0,o.cornerRadius??0),o.program.setUniform4f(r,"uCrop",g?.x??0,g?.y??0,g?.width??0,g?.height??0),o.program.setUniform1i(r,"uRotation",o.rotation??0),o.program.setUniformMatrix3fv(r,"uTransform",!1,k({x:u.padX,y:u.padY,width:u.contentWidth,height:u.contentHeight,rotation:0},u.width,u.height)),r.drawArrays(r.TRIANGLE_STRIP,0,4);let E=[u.padX/u.width,u.padY/u.height,u.contentWidth/u.width,u.contentHeight/u.height],M=e.fps>0?e.frame/e.fps:0;r.disable(r.BLEND),r.bindVertexArray(this._vao),r.activeTexture(r.TEXTURE0);for(let{gpu:x,program:T,params:y}of i){let I=Math.max(1,Math.floor(x.passes(y)));for(let R=0;R<I;R++){let C={pass:R,size:[u.width,u.height],inner:E,pxPerStagePx:u.pxPerStagePx,frame:e.frame,time:M};r.bindFramebuffer(r.FRAMEBUFFER,v.fbo),T.use(r),r.bindTexture(r.TEXTURE_2D,l.texture),T.setUniform1i(r,"uTex",0),T.setUniform2f(r,"uTexel",1/u.width,1/u.height),T.setUniform4f(r,"uInner",E[0],E[1],E[2],E[3]),T.setUniform1f(r,"uTime",M),Fe(r,T,x.uniforms(y,C)),r.drawArrays(r.TRIANGLE_STRIP,0,4);let we=l;l=v,v=we}}if(c&&m){r.bindFramebuffer(r.FRAMEBUFFER,v.fbo),m.use(r),r.bindTexture(r.TEXTURE_2D,l.texture),m.setUniform1i(r,"uTex",0),m.setUniform2f(r,"uTexel",1/u.width,1/u.height),m.setUniform4f(r,"uInner",E[0],E[1],E[2],E[3]);let x;if(o.maskFrame){let[R,C]=u.pxPerStagePx;x={x:(o.maskFrame.x-o.rect.x)*R,y:(o.maskFrame.y-o.rect.y)*C,width:o.maskFrame.width*R,height:o.maskFrame.height*C,rotation:o.maskFrame.rotation}}let{uKind:T,...y}=Te(c,E,[u.width,u.height],x);if(m.setUniform1i(r,"uKind",T),Fe(r,m,y),c.kind==="path"){let R=y.uHalf,C=this._pathTexture(r,c,2*(R[0]??1),2*(R[1]??1));r.activeTexture(r.TEXTURE1),r.bindTexture(r.TEXTURE_2D,C),m.setUniform1i(r,"uPath",1),r.activeTexture(r.TEXTURE0)}r.drawArrays(r.TRIANGLE_STRIP,0,4);let I=l;l=v,v=I}return r.enable(r.BLEND),r.bindFramebuffer(r.FRAMEBUFFER,_??null),r.viewport(h[0]??0,h[1]??0,h[2]??0,h[3]??0),r.clearColor(b[0]??0,b[1]??0,b[2]??0,b[3]??1),(f||s)&&p&&this._placeBlended(r,e,p,l.texture,u.outRect,o.opacity,f??"normal",h,s)?(this._pool.release(r,l),this._pool.release(r,v),this._runs++,!0):(o.program.use(r),r.bindVertexArray(o.vao),r.activeTexture(r.TEXTURE0),r.bindTexture(r.TEXTURE_2D,l.texture),o.program.setUniform1i(r,"uTexture",0),o.program.setUniform1f(r,"uOpacity",o.opacity),o.program.setUniform2f(r,"uRadius",0,0),o.program.setUniform4f(r,"uCrop",0,0,0,0),o.program.setUniform1i(r,"uRotation",0),o.program.setUniformMatrix3fv(r,"uTransform",!1,k(u.outRect,e.stage.width,e.stage.height)),r.drawArrays(r.TRIANGLE_STRIP,0,4),this._pool.release(r,l),this._pool.release(r,v),this._runs++,!0)}get runs(){return this._runs}get pool(){return this._pool}dispose(){let e=this._gl;if(e){for(let o of this._programs.values())o.dispose(e);this._vao&&e.deleteVertexArray(this._vao),this._backdrop&&e.deleteTexture(this._backdrop);for(let o of this._uploaded.values())e.deleteTexture(o);for(let o of this._paths.values())e.deleteTexture(o);this._pool.dispose(e)}this._programs.clear(),this._vao=null,this._backdrop=null,this._backdropSize=[0,0],this._mattes.clear(),this._uploaded.clear(),this._paths.clear(),this._gl=null}notifyContextLost(){this._programs.clear(),this._vao=null,this._backdrop=null,this._backdropSize=[0,0],this._mattes.clear(),this._uploaded.clear(),this._paths.clear(),this._pool.notifyContextLost()}_backdrop=null;_backdropSize=[0,0];_backdropFormat=0;_placeBlended(e,o,r,i,n,c,f,s,m){let[p=0,u=0,l=0,v=0]=s;if(l<=0||v<=0)return!1;if(!this._backdrop){if(this._backdrop=e.createTexture(),!this._backdrop)return!1;e.bindTexture(e.TEXTURE_2D,this._backdrop),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE)}let h=e.getParameter(e.FRAMEBUFFER_BINDING)===null&&e.getContextAttributes()?.alpha===!1?e.RGB:e.RGBA;return e.activeTexture(e.TEXTURE1),e.bindTexture(e.TEXTURE_2D,this._backdrop),(this._backdropSize[0]!==l||this._backdropSize[1]!==v||this._backdropFormat!==h)&&(e.texImage2D(e.TEXTURE_2D,0,h,l,v,0,h,e.UNSIGNED_BYTE,null),this._backdropSize=[l,v],this._backdropFormat=h),e.copyTexSubImage2D(e.TEXTURE_2D,0,0,0,p,u,l,v),r.use(e),e.bindVertexArray(this._vao),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,i),r.setUniform1i(e,"uTexture",0),r.setUniform1i(e,"uBackdrop",1),r.setUniform1f(e,"uOpacity",c),r.setUniform4f(e,"uViewport",p,u,l,v),r.setUniform1i(e,"uMode",Re[f]),r.setUniform1i(e,"uMatteMode",m?.mode??0),r.setUniform1f(e,"uMatteInvert",m?.invert?1:0),r.setUniform1i(e,"uMatte",2),m&&(e.activeTexture(e.TEXTURE2),e.bindTexture(e.TEXTURE_2D,m.texture)),r.setUniform4f(e,"uCrop",0,0,0,0),r.setUniformMatrix3fv(e,"uTransform",!1,k(n,o.stage.width,o.stage.height)),e.disable(e.BLEND),e.drawArrays(e.TRIANGLE_STRIP,0,4),e.enable(e.BLEND),e.activeTexture(e.TEXTURE1),e.bindTexture(e.TEXTURE_2D,null),m&&(e.activeTexture(e.TEXTURE2),e.bindTexture(e.TEXTURE_2D,null)),e.activeTexture(e.TEXTURE0),!0}_mattes=new Map;_uploaded=new Map;renderTarget(e,o,r,i){let{gl:n}=e;this._gl=n;let c=Array.from(n.getParameter(n.VIEWPORT)),[f=0,s=0,m=0,p=0]=c,u=i?Math.max(1,Math.round(i.width)):m,l=i?Math.max(1,Math.round(i.height)):p;if(u<=0||l<=0)return null;let v=this._pool.acquire(n,u,l);if(!v)return null;let _=n.getParameter(n.FRAMEBUFFER_BINDING),h=Array.from(n.getParameter(n.COLOR_CLEAR_VALUE));n.bindFramebuffer(n.FRAMEBUFFER,v.fbo),n.viewport(0,0,u,l),n.clearColor(0,0,0,0),n.clear(n.COLOR_BUFFER_BIT);try{r()}finally{n.bindFramebuffer(n.FRAMEBUFFER,_??null),n.viewport(f,s,m,p),n.clearColor(h[0]??0,h[1]??0,h[2]??0,h[3]??1)}let b=this._mattes.get(o);return b&&this._pool.release(n,b),this._mattes.set(o,v),v}renderMatte(e,o,r){return this.renderTarget(e,o,r)!==null}releaseTargets(e,o){for(let[r,i]of this._mattes)r.startsWith(o)&&(this._uploaded.has(r)||this._pool.release(e,i),this._mattes.delete(r))}setMatteSource(e,o,r){this._gl=e;let i=this._uploaded.get(o);if(!i){if(i=e.createTexture()??void 0,!i)return!1;e.bindTexture(e.TEXTURE_2D,i),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),this._uploaded.set(o,i)}return e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,i),e.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!0),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,r),e.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),e.bindTexture(e.TEXTURE_2D,null),this._mattes.set(o,{fbo:null,texture:i,width:0,height:0}),!0}drawTransition(e,o,r,i){let{gl:n}=e,c=this._mattes.get(o),f=this._mattes.get(r);if(!c||!f)return!1;let s=this._named(n,"__transition",G,Ae);if(!s||!this._vao&&(this._vao=n.createVertexArray(),!this._vao))return!1;let m=Array.from(n.getParameter(n.VIEWPORT)),p=m[2]??0,u=m[3]??0,l=Ue(i.direction);return s.use(n),n.bindVertexArray(this._vao),n.activeTexture(n.TEXTURE0),n.bindTexture(n.TEXTURE_2D,c.texture),n.activeTexture(n.TEXTURE1),n.bindTexture(n.TEXTURE_2D,f.texture),s.setUniform1i(n,"uFrom",0),s.setUniform1i(n,"uTo",1),s.setUniform1f(n,"uT",i.t),s.setUniform1i(n,"uKind",ye[i.kind]??0),s.setUniform2f(n,"uDir",l[0],l[1]),s.setUniform1f(n,"uAspect",u>0?p/u:1),n.enable(n.BLEND),n.blendFunc(n.ONE,n.ONE_MINUS_SRC_ALPHA),n.drawArrays(n.TRIANGLE_STRIP,0,4),n.bindTexture(n.TEXTURE_2D,null),n.activeTexture(n.TEXTURE0),n.bindTexture(n.TEXTURE_2D,null),n.bindVertexArray(null),this._runs++,!0}hasMatte(e){return this._mattes.has(e)}endFrame(e){for(let[o,r]of this._mattes)this._uploaded.has(o)||this._pool.release(e,r);this._mattes.clear()}_paths=new Map;_pathTexture(e,o,r,i){let n=`${o.path}|${JSON.stringify(o.viewBox??null)}|${Math.round(r)}x${Math.round(i)}`,c=this._paths.get(n);if(c)return c;let f=_e(o,r,i);if(!f)return null;let s=e.createTexture();if(!s)return null;if(e.activeTexture(e.TEXTURE1),e.bindTexture(e.TEXTURE_2D,s),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,f),e.bindTexture(e.TEXTURE_2D,null),e.activeTexture(e.TEXTURE0),this._paths.size>=8){let[m,p]=this._paths.entries().next().value;e.deleteTexture(p),this._paths.delete(m)}return this._paths.set(n,s),s}_named(e,o,r,i){let n=this._programs.get(o);if(n)return n;if(this._broken.has(o))return null;try{let c=L.create(e,r,i);return this._programs.set(o,c),c}catch(c){return this._broken.add(o),console.warn(`[EffectChain] ${o} disabled: ${c.message}`),null}}_program(e,o){let r=this._programs.get(o.kind);if(r)return r;if(this._broken.has(o.kind))return null;try{let i=L.create(e,G,o.frag);return this._programs.set(o.kind,i),i}catch(i){return this._broken.add(o.kind),console.warn(`[EffectChain] ${o.kind} disabled: ${i.message}`),null}}};function Fe(t,e,o){for(let[r,i]of Object.entries(o))typeof i=="number"?e.setUniform1f(t,r,i):i.length===2?e.setUniform2f(t,r,i[0],i[1]):i.length===3?e.setUniform3f(t,r,i[0],i[1],i[2]):i.length===4&&e.setUniform4f(t,r,i[0],i[1],i[2],i[3])}export{Me as EffectChain,Ge as MAX_CHAIN_PADDING,Ce as MAX_CHAIN_SIDE,Ie as planChain};
