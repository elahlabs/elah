import { describe, it, expect } from 'vitest'
import { validateScene } from './validate'

const STAT_HTML = `<section data-scene="stat" data-at="12.0" data-duration="4.0"
         style="display:flex; align-items:center; justify-content:center; gap:48px; width:1080px; height:1920px">
  <div id="ring" style="width:420px; height:420px" data-motion="draw: 0 → 0.72 1.2s expo-out @0.3; in: pop-in 0.3s">
    <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="none" stroke="#ffd166" stroke-width="8"/></svg>
  </div>
  <div style="display:flex; flex-direction:column; gap:12px" data-motion="stagger: children 4f">
    <h1 id="big" style="font-family:bebas-neue; font-size:220px; color:#fff; line-height:0.9"
        data-motion="in: slide-in-up 0.4s overshoot @0.4">72%</h1>
    <p id="label" style="font-family:inter; font-size:44px; color:#9aa4b2; max-width:520px"
       data-motion="in: fade-in 0.3s @0.6; out: fade-out 0.3s @-0.3">of attacks start on free Wi-Fi</p>
  </div>
</section>
<style>
  :root { --accent: #ffd166; }
</style>`

const ok = (html: string, css = '') => validateScene({ html, css })
const props = (html: string, css = '') => validateScene({ html, css }).violations.map((v) => v.property)

describe('validateScene accepts', () => {
  it('the plan 4.5 stat scene', () => {
    const r = validateScene({ html: STAT_HTML, css: '' })
    expect(r.violations).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('every whitelisted tag', () => {
    for (const tag of ['div', 'section', 'header', 'footer', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span']) {
      expect(ok(`<${tag} id="a">x</${tag}>`).ok).toBe(true)
    }
    expect(ok('<ul><li>a</li><li>b</li></ul><ol><li>c</li></ol>').ok).toBe(true)
    expect(ok('<img id="p" src="elah-asset:abc" width="10" height="10">').ok).toBe(true)
  })

  it('the layout and look properties of plan 4.2', () => {
    const css = [
      'position:relative', 'display:grid', 'inset:0', 'gap:8px', 'width:10px', 'min-width:1px', 'max-height:9px', 'margin:4px', 'padding:4px',
      'box-sizing:border-box', 'justify-content:center', 'align-items:flex-end', 'flex:1 1 0', 'grid-template-columns:1fr 1fr',
      "font-family:'Inter', sans-serif", 'font-size:20px', 'font-weight:700', 'font-style:italic', 'letter-spacing:2px', 'line-height:1.2',
      'text-align:center', 'white-space:nowrap', 'color:#fff', 'background:linear-gradient(90deg,#000,#fff)', 'background-color:#111',
      'border:2px solid #fff', 'border-radius:12px', 'opacity:.5', 'text-shadow:0 2px 4px #000', '-webkit-text-stroke:2px #fff',
      'background-clip:text', 'mix-blend-mode:soft-light', 'clip-path:inset(0 round 8px)', 'overflow:hidden',
      'translate:10px 20px', 'rotate:12deg', 'scale:1.2', 'transform-origin:left top', 'z-index:3', 'filter:blur(4px) drop-shadow(0 2px 4px #000)',
    ].join(';')
    expect(validateScene({ html: `<div id="a" style="${css}">x</div>`, css: '' }).violations).toEqual([])
  })

  it('a style block with :root variables, #id and .class rules', () => {
    const r = ok('<div id="a" class="b">x</div>', '')
    expect(r.ok).toBe(true)
    const s = validateScene({ html: '<div id="a" class="b">x</div><style>:root{--accent:#fff} #a{color:red} .b{opacity:.5}</style>', css: '' })
    expect(s.violations).toEqual([])
  })

  it('svg content with arbitrary inner tags', () => {
    expect(ok('<svg viewBox="0 0 1 1"><defs><linearGradient id="g"/></defs><path d="M0 0" fill="url(#g)"/></svg>').ok).toBe(true)
  })
})

describe('validateScene refuses with the plan 4.2 substitutes', () => {
  const one = (style: string) => validateScene({ html: `<div id="a" style="${style}">x</div>`, css: '' }).violations

  it('an inset or listed box-shadow → one outer shadow', () => {
    const [v] = one('box-shadow:inset 0 0 10px #000')
    expect(v.property).toBe('box-shadow')
    expect(v.substitute).toContain('one outer shadow')
    expect(v.element).toBe('#a')
  })

  it('backdrop-filter → an adjustment clip beneath', () => {
    expect(one('backdrop-filter:blur(8px)')[0].substitute).toContain('adjustment clip beneath')
  })

  it('text-transform → write the text in the case you want', () => {
    expect(one('text-transform:uppercase')[0].substitute).toBe('write the text in the case you want')
  })

  it('an unknown font → the nearest bundled family by role', () => {
    expect(one("font-family:'Helvetica Neue', sans-serif")[0].substitute).toBe('inter')
    expect(one('font-family:Georgia, serif')[0].substitute).toBe('playfair-display')
    expect(one('font-family:Courier New, monospace')[0].substitute).toBe('roboto-mono')
    expect(one('font-family:Impact')[0].substitute).toBe('bebas-neue')
    expect(one('font-family:bebas-neue')).toEqual([])
  })

  it('3D, skew, repeating gradients, other text-decorations, elliptical radius', () => {
    expect(one('perspective:100px')[0].property).toBe('perspective')
    expect(one('transform:rotateX(20deg)')[0].property).toBe('transform')
    expect(one('transform:skewX(10deg)')[0].property).toBe('transform')
    // MOT-8: the refusal names the channels that do the job.
    expect(one('transform:skewX(10deg)')[0].substitute).toMatch(/skewX/)
    expect(one('skew:10deg')[0].substitute).toMatch(/skewX: 0/)
    // MOT-8 phase B: the 3D refusals name rotateX / rotateY, the channels that do the job.
    expect(one('transform:rotateX(20deg)')[0].substitute).toMatch(/rotateX \/ rotateY/)
    expect(one('perspective:100px')[0].substitute).toMatch(/rotateY: 0 → 90deg/)
    expect(one('transform-style:preserve-3d')[0].property).toBe('transform-style')
    expect(one('backface-visibility:hidden')[0].substitute).toMatch(/swap opacity/)
    expect(one('background:repeating-linear-gradient(red, blue 10px)')[0].message).toMatch(/repeating/)
    expect(one('text-decoration:underline wavy red')[0].property).toBe('text-decoration')
    expect(one('border-radius:4px / 8px')[0].message).toMatch(/elliptical/)
    expect(one('filter:grayscale(1)')[0].property).toBe('filter')
    expect(one('width:calc(100vw - 4px)')[0].message).toMatch(/viewport/)
    expect(one('mix-blend-mode:color-dodge')[0].property).toBe('mix-blend-mode')
  })

  it('@font-face, @import, pseudo-classes and pseudo-elements', () => {
    const r = validateScene({ html: '<div id="a">x</div>', css: '@font-face{font-family:X} @import url(x.css); #a:hover{color:red} #a::before{content:"x"} div{color:red}' })
    const msgs = r.violations.map((v) => v.property)
    expect(msgs).toContain('@font-face')
    expect(msgs).toContain('@import')
    expect(r.violations.filter((v) => v.property === 'selector').length).toBe(3)
  })

  it('refused tags carry a substitute where one exists', () => {
    const r = validateScene({ html: '<canvas id="c"></canvas><video></video><button>x</button>', css: '' })
    expect(r.violations.map((v) => v.property)).toEqual(['canvas', 'video', 'button'])
    expect(r.violations[0].substitute).toBeTruthy()
  })

  it('CSS variables are only allowed on :root', () => {
    expect(one('--x:1')[0].message).toMatch(/:root/)
  })
})

describe('validateScene always refuses', () => {
  it('<script>, on* handlers and javascript: URLs', () => {
    expect(ok('<script>alert(1)</script><div id="a">x</div>').ok).toBe(false)
    expect(props('<div id="a" onclick="x()">x</div>')).toEqual(['onclick'])
    expect(props('<img src="javascript:alert(1)">')).toEqual(['src'])
    // Inside svg too.
    expect(props('<svg><circle onload="x()"/></svg>')).toEqual(['onload'])
  })

  it('external URLs in src, href and url()', () => {
    expect(props('<img src="https://x.test/a.png">')).toEqual(['src'])
    expect(props('<img src="//x.test/a.png">')).toEqual(['src'])
    expect(props('<div id="a" style="background:url(https://x.test/a.png)">x</div>')).toEqual(['background'])
    expect(props('<svg><image href="http://x.test/a.png"/></svg>')).toEqual(['href'])
    expect(validateScene({ html: '<div id="a">x</div>', css: '#a{background-image:url("http://x.test/a.png")}' }).violations[0].property).toBe('background-image')
  })

  it('attributes outside the subset', () => {
    expect(props('<div id="a" contenteditable>x</div>')).toEqual(['contenteditable'])
  })

  it('names the element by id, else by tag path', () => {
    const r = validateScene({ html: '<section><div><span style="text-transform:uppercase">x</span></div></section>', css: '' })
    expect(r.violations[0].element).toBe('section[0] > div[0] > span[0]')
  })
})

describe('validateScene: data-motion labels (MOT-6)', () => {
  const scene = (a: string, b: string) => `<section style="width:100px; height:100px"><div id="a" style="width:10px; height:10px" data-motion="${a}"></div><div id="b" style="width:10px; height:10px" data-motion="${b}"></div></section>`

  it('accepts a label declared anywhere in the scene, before or after its use', () => {
    expect(ok(scene('in: fade-in 0.3s @go', 'label: go @1')).violations).toEqual([])
  })

  it('refuses a label nothing declares and suggests the nearest', () => {
    const r = ok(scene('in: fade-in 0.3s @goo', 'label: go @1'))
    expect(r.ok).toBe(false)
    expect(r.violations[0]).toMatchObject({ property: 'data-motion', substitute: 'go' })
    expect(r.violations[0].message).toMatch(/never declared/)
  })
})
