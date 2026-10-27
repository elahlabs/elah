// node --test plugins/elah/scripts/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const run = (...args) => spawnSync(process.execPath, [join(HERE, 'validate.mjs'), ...args], { encoding: 'utf8' })
const fx = (name) => join(HERE, 'fixtures', name)

test('valid spec: exit 0 with a one-line summary', () => {
  const r = run(fx('valid-spec.json'))
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /^OK: spec "Launch card", 1080x1920 @ 30 fps/)
})

test('invalid spec: exit 1 and every compiler error is listed', () => {
  const r = run(fx('invalid-spec.json'))
  assert.equal(r.status, 1)
  assert.match(r.stdout, /^FAILED: 2 errors/)
  assert.match(r.stdout, /elements\[1\]\.font: unknown font role "\$nope"/)
  assert.match(r.stdout, /elements\[1\]\.enter: unknown motion preset "teleport-in"/)
})

test('html scene: valid passes, refused CSS lists each property with its substitute', () => {
  assert.equal(run(fx('valid-html.json')).status, 0)
  const r = run(fx('invalid-html.json'))
  assert.equal(r.status, 1)
  assert.match(r.stdout, /animation: spin 1s/)
  assert.match(r.stdout, /use instead: data-motion on the element/)
  assert.match(r.stdout, /text-transform/)
})

test('project input: valid passes, unreadable fails', () => {
  const ok = run(fx('valid-project.json'))
  assert.equal(ok.status, 0, ok.stdout)
  assert.match(ok.stdout, /^OK: project/)
  const bad = run(fx('invalid-project.json'))
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /no list of tracks/)
})

test('bad envelope and unreadable files exit 1', () => {
  assert.match(run(fx('invalid-kind.json')).stdout, /source\.kind: must be/)
  assert.equal(run(fx('invalid-kind.json')).status, 1)
  const r = run(fx('not-json.json'))
  assert.equal(r.status, 1)
  assert.match(r.stdout, /cannot read .* as JSON/)
  assert.equal(run(fx('does-not-exist.json')).status, 1)
})

test('--json prints a machine-readable result', () => {
  const r = run('--json', fx('invalid-spec.json'))
  assert.equal(r.status, 1)
  const out = JSON.parse(r.stdout)
  assert.equal(out.ok, false)
  assert.ok(out.issues.some((i) => i.severity === 'error' && /unknown-token/.test(i.message)))
})

test('--notes adds the polish info notes to the plain output; without it they are hidden', () => {
  const plain = run(fx('valid-spec.json'))
  assert.equal(plain.status, 0)
  assert.doesNotMatch(plain.stdout, /info:/)
  const withNotes = run('--notes', fx('valid-spec.json'))
  assert.equal(withNotes.status, 0, withNotes.stdout + withNotes.stderr)
  assert.match(withNotes.stdout, /^OK: spec "Launch card"/)
  assert.match(withNotes.stdout, /info: .*\[polished\]/)
})

test('--vocabulary prints the spec vocabulary; no arguments is a usage error', () => {
  const v = run('--vocabulary')
  assert.equal(v.status, 0)
  assert.match(v.stdout, /FONTS/)
  assert.equal(run().status, 2)
})

// ---- kind: "page" (PLAN-HTML-FIRST section 3) -------------------------------------------------------------------------

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const pageDoc = (patch = {}) => {
  const base = JSON.parse(readFileSync(fx('valid-page.json'), 'utf8'))
  return { ...base, source: { ...base.source, ...patch } }
}
const runDoc = (doc, ...flags) => {
  const dir = mkdtempSync(join(tmpdir(), 'elah-page-'))
  const file = join(dir, 'elah-input.json')
  writeFileSync(file, JSON.stringify(doc))
  return run(...flags, file)
}

test('page: the reference example is valid and is the programmatic/example.md example verbatim', () => {
  const r = run(fx('valid-page.json'))
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /^OK: programmatic video "Orbit 2 launch", 1920x1080 @ 30 fps, 6 s, 2 scenes, 13 animations, 9 keyframe sets\n$/)
  const md = readFileSync(join(HERE, '..', 'reference', 'programmatic', 'example.md'), 'utf8').replace(/\r\n/g, '\n')
  const html = md.match(/```html\n([\s\S]*?)```/)[1]
  const cssText = md.match(/```css\n([\s\S]*?)```/)[1]
  const fixture = JSON.parse(readFileSync(fx('valid-page.json'), 'utf8')).source
  assert.equal(html, fixture.html)
  assert.equal(cssText, fixture.css)
})

test('page: every refused construct is listed with its substitute', () => {
  const r = run(fx('invalid-page.json'))
  assert.equal(r.status, 1)
  const out = r.stdout
  assert.match(out, /<script>: scripts are not allowed in a programmatic video/)
  assert.match(out, /<video>: <video> is not allowed .*a programmatic video has no media files/)
  assert.match(out, /<main onclick>: event-handler attributes/)
  for (const tag of ['iframe', 'link', 'video', 'animate']) assert.match(out, new RegExp(`<${tag}>: <${tag}> is not allowed`), tag)
  assert.match(out, /<img src>: src="https:\/\/example\.com\/a\.png" points outside the video/)
  assert.match(out, /@import fetches over the network/)
  assert.match(out, /@font-face is not allowed .*use instead: font-family: one of inter/)
  assert.match(out, /url\(https:\/\/example\.com\/bg\.png\) points outside the video/)
  assert.match(out, /transition never runs .*use instead: @keyframes plus animation/)
  assert.match(out, /animation-play-state must not be authored/)
  assert.match(out, /\.b: animation-play-state \(paused or running\) must not be authored, not even inside the animation shorthand/)
  assert.match(out, /the font shorthand hides the family/)
  assert.match(out, /font-family comic sans ms, cursive is not a bundled font/)
  assert.match(out, /font-family georgia is not a bundled font/)
})

test('page: warnings are reported but exit 0', () => {
  const r = run(fx('warn-page.json'))
  assert.equal(r.status, 0, r.stdout)
  assert.match(r.stdout, /^OK: programmatic video "Warning sample", 1080x1920/)
  assert.match(r.stdout, /body: html, body and :root do not match/)
  assert.match(r.stdout, /\.a \{ animation: rise \}: the animation has no explicit duration/)
  assert.match(r.stdout, /\.b \{ animation: spin \}: infinite animation: allowed/)
  assert.match(r.stdout, /\.c \{ animation: rise \}: delay 2 s without fill-mode backwards or both/)
  assert.doesNotMatch(r.stdout, /\.d \{ animation: rise \}: delay/)
  assert.match(r.stdout, /\.d \{ animation: rise \}: it ends at 6\.50 s, after the video's 6 s end/)
  assert.match(r.stdout, /animation "missing" has no @keyframes missing/)
  assert.match(r.stdout, /@keyframes unused is defined but no animation uses it/)
  assert.match(r.stdout, /no \[data-scene\] element/)
})

test('page: envelope fields are required and range-checked', () => {
  const bad = runDoc(pageDoc({ html: '', css: 5, durationSeconds: 0, stage: { width: 1920.5, height: 0 }, fps: 12 }))
  assert.equal(bad.status, 1)
  for (const m of [/source\.html: must be a non-empty HTML string/, /source\.css: must be a string/, /source\.durationSeconds: must be a positive number/, /source\.stage: must be \{ width, height \} with positive integers/, /source\.fps: must be an integer from 24 to 60/]) {
    assert.match(bad.stdout, m)
  }
  assert.match(runDoc(pageDoc({ fps: 120 })).stdout, /source\.fps/)
  assert.match(runDoc(pageDoc({ fps: 29.97 })).stdout, /source\.fps/)
  assert.equal(runDoc(pageDoc({ fps: 24 })).status, 0)
  assert.equal(runDoc(pageDoc({ fps: 60 })).status, 0)
  assert.match(run(fx('invalid-kind.json')).stdout, /"page" \(programmatic video, the default\), "spec", "html" or "project"/)
})

test('page: markup over 64 KB and CSS over 32 KB are refused', () => {
  const bigHtml = runDoc(pageDoc({ html: `<main class="stage" data-scene="a">${'<i></i>'.repeat(11000)}</main>` }))
  assert.equal(bigHtml.status, 1)
  assert.match(bigHtml.stdout, /source\.html: markup is 7\d\.\d KB; the cap is 64 KB/)
  const bigCss = runDoc(pageDoc({ css: `${pageDoc().source.css}\n${'.x{color:red}\n'.repeat(3000)}` }))
  assert.equal(bigCss.status, 1)
  assert.match(bigCss.stdout, /source\.css: CSS is \d+\.\d KB; the cap is 32 KB/)
})

test('page: url() allows data: and #fragments, a font may come through a custom property, bundled fonts pass', () => {
  const okCss = `${pageDoc().source.css}\n.g { background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>"); clip-path: url(#c); font-family: var(--f); --f: playfair-display, serif; }\n.h { font-family: 'Space Grotesk'; }`
  const r = runDoc(pageDoc({ css: okCss }))
  assert.equal(r.status, 1) // 'Space Grotesk' (spaces, not the id) is refused, the rest is fine
  assert.match(r.stdout, /font-family space grotesk is not a bundled font/)
  assert.doesNotMatch(r.stdout, /points outside the video/)
  assert.doesNotMatch(r.stdout, /playfair-display is not a bundled font/)
  const viaVar = runDoc(pageDoc({ css: `${pageDoc().source.css}\n.g { font-family: var(--f); --f: Georgia; }` }))
  assert.match(viaVar.stdout, /font-family georgia is not a bundled font/)
})

test('page: animation values kept in custom properties and computed delays are read', () => {
  const css = `.stage { --ease: cubic-bezier(0.2, 1, 0.3, 1); --t: 0.5s; }\n.a { animation: k var(--t) var(--ease) 1s both; }\n.b { animation: k 0.5s var(--ease) calc(var(--at, 0s) + 2 * 0.1s); }\n@keyframes k { to { opacity: 1 } }`
  const r = runDoc(pageDoc({ html: '<main class="stage"><i class="a" data-scene="a"></i><i class="b"></i></main>', css }))
  assert.equal(r.status, 0, r.stdout)
  assert.doesNotMatch(r.stdout, /\.a \{ animation: k \}/)
  assert.match(r.stdout, /\.b \{ animation: k \}: a computed delay without fill-mode/)
  assert.doesNotMatch(r.stdout, /no explicit duration/)
})

test('page: animation-timeline, <style>, <meta http-equiv>, javascript: links and a stray <body> are caught', () => {
  const html = '<body><main class="stage" data-scene="a"><style>.x{color:red}</style><meta http-equiv="refresh" content="0"><a href="javascript:alert(1)">x</a></main></body>'
  const r = runDoc(pageDoc({ html, css: `${pageDoc().source.css}\n.q { animation-timeline: scroll(); }` }))
  assert.equal(r.status, 1)
  assert.match(r.stdout, /<style>: <style> is not allowed .*use instead: the css field/)
  assert.match(r.stdout, /<meta http-equiv>/)
  assert.match(r.stdout, /<a href>: href="javascript:alert\(1\)" points outside the video/)
  assert.match(r.stdout, /animation-timeline .* cannot be seeked/)
  assert.match(r.stdout, /warn: source\.html: html is a fragment inside the stage/)
})

test('page: every recipe in programmatic/recipes.md composes into one video with no errors and no warnings', () => {
  const md = readFileSync(join(HERE, '..', 'reference', 'programmatic', 'recipes.md'), 'utf8').replace(/\r\n/g, '\n')
  const htmls = [...md.matchAll(/```html\n([\s\S]*?)```/g)].map((m) => m[1])
  const csses = [...md.matchAll(/```css\n([\s\S]*?)```/g)].map((m) => m[1])
  assert.ok(htmls.length >= 19, `expected 19 recipe scenes, found ${htmls.length}`)
  assert.equal(csses.length, htmls.length + 1, 'the shared base plus one css block per recipe')
  const r = runDoc(pageDoc({ html: `<main class="stage">\n${htmls.join('\n')}\n</main>`, css: csses.join('\n'), durationSeconds: 90 }), '--json')
  const out = JSON.parse(r.stdout)
  assert.equal(r.status, 0, JSON.stringify(out.issues.filter((i) => i.severity !== 'info'), null, 1))
  assert.deepEqual(out.issues.filter((i) => i.severity !== 'info'), [])
})

test('page: --json carries the page issues', () => {
  const out = JSON.parse(run('--json', fx('invalid-page.json')).stdout)
  assert.equal(out.ok, false)
  assert.ok(out.issues.some((i) => i.severity === 'error' && i.substitute && /bundled|data:/.test(i.substitute + i.message)))
})

test('--vocabulary lists the authored kinds, including component, system and vector', () => {
  const v = run('--vocabulary')
  assert.equal(v.status, 0)
  const line = v.stdout.split('\n').find((l) => l.startsWith('KINDS'))
  assert.ok(line, 'a KINDS line is printed')
  for (const kind of ['text', 'shape', 'icon', 'image', 'audio', 'generator', 'group', 'component', 'system', 'vector']) {
    assert.match(line, new RegExp(`\\b${kind}\\b`), `${kind} is listed`)
  }
  assert.equal(v.stdout.split('\n').filter((l) => l.startsWith('KINDS')).length, 1)
  assert.match(line, /: page \(programmatic video, the default\), text, /, 'page leads the line as the programmatic video')
})

// ---- supplied images in assets/ (TICKET-PF-11) ------------------------------------------------------------------------

import { mkdirSync } from 'node:fs'

const assetsDoc = () => JSON.parse(readFileSync(fx('valid-page-assets/elah-input.json'), 'utf8'))
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** A work folder with elah-input.json and assets/<name> files: `files` maps a name to its bytes. */
const runWork = (doc, files) => {
  const dir = mkdtempSync(join(tmpdir(), 'elah-assets-'))
  mkdirSync(join(dir, 'assets'))
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dir, 'assets', name), bytes)
  writeFileSync(join(dir, 'elah-input.json'), JSON.stringify(doc))
  return run(join(dir, 'elah-input.json'))
}
const withImg = (doc, ...srcs) => ({ ...doc, source: { ...doc.source, html: doc.source.html.replace('</main>', `${srcs.map((s) => `<img src="${s}">`).join('')}</main>`) } })

test('page assets: a PNG and an SVG in assets/ beside the input pass (src, ./src and css url())', () => {
  const r = run(fx('valid-page-assets/elah-input.json'))
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /^OK: programmatic video "Logo sample", 1920x1080 @ 30 fps, 6 s, 2 scenes, 7 animations, 6 keyframe sets, 2 images in assets\/ \(\d+ KB\)\n$/)
})

test('page assets: a missing file is refused, resolved against the input folder', () => {
  const r = run(fx('invalid-page-assets-missing.json'))
  assert.equal(r.status, 1)
  assert.match(r.stdout, /assets\/nope\.png does not exist: there is no file .*fixtures[\\/]assets[\\/]nope\.png/)
  assert.match(r.stdout, /assets\/badge\.svg does not exist/) // resolved beside THIS input, not the valid fixture
})

test('page assets: escapes, other folders, absolute paths and network URLs are refused', () => {
  const r = run(fx('invalid-page-assets-escape.json'))
  assert.equal(r.status, 1)
  const out = r.stdout
  for (const ref of ['../assets/logo.png', '/etc/badge.svg', 'assets/sub/x.png', 'assets/../valid-page-assets/', 'C:\\logo.png']) {
    assert.match(out, new RegExp(`src="${ref.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}[^"]*" is not a file in the assets/ folder`), ref)
  }
  assert.match(out, /url\(\.\.\/badge\.svg\) is not a file in the assets\/ folder/)
  assert.match(out, /src="https:\/\/example\.com\/logo\.png" points outside the video \(no network\)/)
  assert.doesNotMatch(out, /does not exist/) // nothing outside assets/ is ever looked up
})

test('page assets: over 15 MB each, over 40 MB in total, wrong type and wrong contents are refused', () => {
  const doc = assetsDoc()
  const big = Buffer.concat([PNG_HEAD, Buffer.alloc(15 * 1024 * 1024 + 1 - PNG_HEAD.length)])
  const one = runWork(withImg(doc, 'assets/big.png'), { 'logo.png': PNG_HEAD, 'badge.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>', 'big.png': big })
  assert.equal(one.status, 1)
  assert.match(one.stdout, /assets\/big\.png is 15\.0 MB; one image may be at most 15 MB/)

  const chunk = Buffer.concat([PNG_HEAD, Buffer.alloc(14 * 1024 * 1024 - PNG_HEAD.length)])
  const total = runWork(withImg(doc, 'assets/a.png', 'assets/b.png', 'assets/c.png'), { 'logo.png': PNG_HEAD, 'badge.svg': '<svg/>', 'a.png': chunk, 'b.png': chunk, 'c.png': chunk })
  assert.equal(total.status, 1)
  assert.match(total.stdout, /the images add up to 42\.0 MB; together they may be at most 40 MB/)

  const types = runWork(withImg(doc, 'assets/anim.gif', 'assets/fake.png', 'assets/photo.jpg', 'assets/shot.webp'), {
    'logo.png': PNG_HEAD,
    'badge.svg': '<svg/>',
    'anim.gif': 'GIF89a',
    'fake.png': 'not a png',
    'photo.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    'shot.webp': Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]),
  })
  assert.equal(types.status, 1)
  assert.match(types.stdout, /^FAILED: 2 errors/)
  assert.match(types.stdout, /assets\/anim\.gif is not a supported image type \(png, jpg, jpeg, webp, svg\)/)
  assert.match(types.stdout, /assets\/fake\.png is not a PNG file/)
})

// ---- sound cues: data-sfx (TICKET-PF-13) -------------------------------------------------------------------------------

const sfxDoc = (patch = {}) => {
  const base = JSON.parse(readFileSync(fx('valid-page-sfx.json'), 'utf8'))
  return { ...base, source: { ...base.source, ...patch } }
}

test('page sfx: the sample with five cues is valid and the summary counts them', () => {
  const r = run(fx('valid-page-sfx.json'))
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /^OK: programmatic video "Orbit 2 launch \(with sound\)", .*, 9 keyframe sets, 5 sound cues\n$/)
})

test('page sfx: an unknown cue word is an error that names the valid words; a synonym passes', () => {
  const base = sfxDoc()
  const bad = runDoc(sfxDoc({ html: base.source.html.replace('data-sfx="chime"', 'data-sfx="boom"') }))
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /error: source\.html <p\.sub\.u2> data-sfx="boom": "boom" is not a sound in the bundled pack \(use instead: one of whoosh, swoosh, pop, click, tick, snap, impact, chime, or a searched sound: node sfx-search\.mjs/)
  const syn = runDoc(sfxDoc({ html: base.source.html.replace('data-sfx="chime"', 'data-sfx="Ding"') }))
  assert.equal(syn.status, 0, syn.stdout)
})

test('page sfx: cues closer than 0.25 s warn, with calc(var(--at)) delays and scene cues read', () => {
  const base = sfxDoc()
  // the pop on .dot (3.3 s) next to a new cue on .l2 (3.25 s): 50 ms apart
  const r = runDoc(sfxDoc({ html: base.source.html.replace('<p class="label l2">', '<p class="label l2" data-sfx="click">') }), '--json')
  const out = JSON.parse(r.stdout)
  assert.equal(r.status, 0)
  const warns = out.issues.filter((i) => i.severity === 'warn')
  assert.equal(warns.length, 1, JSON.stringify(warns))
  assert.match(warns[0].path, /data-sfx="pop"/)
  assert.match(warns[0].message, /plays at 3\.30 s, 50 ms after "click" at 3\.25 s/)
  // the scene cue (swoosh at 3.0 s) and the calc(var(--at) + 1.2s) chime (4.2 s) are timed: moving the chime to 3.1 s warns
  const css = base.source.css.replace('calc(var(--at) + 1.2s)', 'calc(var(--at) + 0.1s)')
  const r2 = JSON.parse(runDoc(sfxDoc({ css }), '--json').stdout)
  assert.ok(r2.issues.some((i) => i.severity === 'warn' && /data-sfx="chime"/.test(i.path) && /plays at 3\.10 s, 100 ms after "swoosh" at 3\.00 s/.test(i.message)), JSON.stringify(r2.issues))
})

test('page sfx: more than 24 cues warn; a bad gain and a cue with no animation warn', () => {
  const base = sfxDoc()
  const many = Array.from({ length: 25 }, (_, i) => `<i class="m" style="animation: rise 0.2s linear ${(i * 0.2).toFixed(1)}s both" data-sfx="tick"></i>`).join('')
  const r = JSON.parse(runDoc(sfxDoc({ html: base.source.html.replace('</main>', `${many}</main>`), durationSeconds: 6 }), '--json').stdout)
  assert.ok(r.issues.some((i) => i.severity === 'warn' && /30 sound cues; more than 24/.test(i.message)), JSON.stringify(r.issues.filter((i) => i.severity === 'warn')))
  const odd = base.source.html.replace('data-sfx-gain="0.8"', 'data-sfx-gain="loud"').replace('</main>', '<i class="still" data-sfx="snap"></i></main>')
  const r2 = JSON.parse(runDoc(sfxDoc({ html: odd }), '--json').stdout)
  assert.ok(r2.issues.some((i) => i.severity === 'warn' && /data-sfx-gain="loud" is not a number from 0 to 1/.test(i.message)))
  assert.ok(r2.issues.some((i) => i.severity === 'warn' && /<i\.still> data-sfx="snap"/.test(i.path) && /no animation, so the sound plays at 0 s/.test(i.message)))
})

// ---- searched sounds in assets/sfx/ (TICKET-PF-12b) -------------------------------------------------------------------

const MP3_HEAD = Buffer.concat([Buffer.from('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000', 'latin1'), Buffer.alloc(64)])
/** A work folder with elah-input.json and assets/sfx/<name> files. */
const runSfxWork = (doc, files) => {
  const dir = mkdtempSync(join(tmpdir(), 'elah-sfx-'))
  mkdirSync(join(dir, 'assets', 'sfx'), { recursive: true })
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dir, 'assets', 'sfx', name), bytes)
  writeFileSync(join(dir, 'elah-input.json'), JSON.stringify(doc))
  return run(join(dir, 'elah-input.json'))
}
const sfxPageDoc = (cue) => {
  const doc = JSON.parse(readFileSync(fx('valid-page-sfx.json'), 'utf8'))
  doc.source.html = doc.source.html.replace('data-sfx="pop"', `data-sfx="${cue}"`)
  return doc
}

test('searched sound: assets/sfx/<name>.mp3 beside the input passes in a programmatic video, pack words still work', () => {
  const r = runSfxWork(sfxPageDoc('assets/sfx/camera-shutter.mp3'), { 'camera-shutter.mp3': MP3_HEAD })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /5 sound cues\n$/)
})

test('searched sound: a missing file, a path escape, another folder, a non-mp3 and a big file are refused', () => {
  const missing = runSfxWork(sfxPageDoc('assets/sfx/nope.mp3'), {})
  assert.equal(missing.status, 1)
  assert.match(missing.stdout, /assets\/sfx\/nope\.mp3 does not exist/)
  for (const cue of ['assets/sfx/../logo.mp3', '../assets/sfx/a.mp3', 'assets/sfx/sub/a.mp3', 'assets/a.mp3', '/etc/a.mp3', 'assets/sfx/a.wav']) {
    const r = runSfxWork(sfxPageDoc(cue), { 'a.mp3': MP3_HEAD })
    assert.equal(r.status, 1, cue)
    assert.match(r.stdout, /is not a file in assets\/sfx\//, cue)
  }
  const wrong = runSfxWork(sfxPageDoc('assets/sfx/a.mp3'), { 'a.mp3': Buffer.from('RIFF....WAVE') })
  assert.match(wrong.stdout, /is not an MP3 file/)
  const big = runSfxWork(sfxPageDoc('assets/sfx/a.mp3'), { 'a.mp3': Buffer.concat([MP3_HEAD, Buffer.alloc(2 * 1048576)]) })
  assert.match(big.stdout, /one sound may be at most 2 MB/)
})

test('searched sound: a VideoSpec sfx cue path is checked the same way', () => {
  const doc = JSON.parse(readFileSync(fx('valid-spec.json'), 'utf8'))
  doc.source.spec.sfx = [{ at: 1, cue: 'assets/sfx/camera-shutter.mp3' }, { at: 2, cue: 'whoosh' }]
  const ok = runSfxWork(doc, { 'camera-shutter.mp3': MP3_HEAD })
  assert.equal(ok.status, 0, ok.stdout + ok.stderr)
  const missing = runSfxWork(doc, {})
  assert.equal(missing.status, 1)
  assert.match(missing.stdout, /assets\/sfx\/camera-shutter\.mp3 does not exist/)
  doc.source.spec.sfx = [{ at: 1, cue: 'assets/sfx/../x.mp3' }]
  assert.match(runSfxWork(doc, {}).stdout, /is not a file in assets\/sfx\//)
})
