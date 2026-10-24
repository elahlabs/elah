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

test('page: the reference example is valid and is the page.md example verbatim', () => {
  const r = run(fx('valid-page.json'))
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /^OK: page "Orbit 2 page", 1920x1080 @ 30 fps, 6 s, 2 scenes, 13 animations, 9 keyframe sets\n$/)
  const md = readFileSync(join(HERE, '..', 'reference', 'page', 'example.md'), 'utf8').replace(/\r\n/g, '\n')
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
  assert.match(out, /<script>: scripts are not allowed/)
  assert.match(out, /<main onclick>: event-handler attributes/)
  for (const tag of ['iframe', 'link', 'video', 'animate']) assert.match(out, new RegExp(`<${tag}>: <${tag}> is not allowed`), tag)
  assert.match(out, /<img src>: src="https:\/\/example\.com\/a\.png" points outside the page/)
  assert.match(out, /@import fetches over the network/)
  assert.match(out, /@font-face is not allowed .*use instead: font-family: one of inter/)
  assert.match(out, /url\(https:\/\/example\.com\/bg\.png\) points outside the page/)
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
  assert.match(r.stdout, /^OK: page "Warning page", 1080x1920/)
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
  assert.match(run(fx('invalid-kind.json')).stdout, /"spec", "html", "page" or "project"/)
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
  assert.doesNotMatch(r.stdout, /points outside the page/)
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
  assert.match(r.stdout, /<a href>: href="javascript:alert\(1\)" points outside the page/)
  assert.match(r.stdout, /animation-timeline .* cannot be seeked/)
  assert.match(r.stdout, /warn: source\.html: html is a fragment inside the stage/)
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
})
