/**
 * Source of plugins/elah/scripts/validate.mjs. Do not run this file: `node plugins/elah/build.mjs`
 * bundles it with the engine's spec compiler and HTML-subset validator into one plain-Node script.
 *
 *   node validate.mjs <elah-input.json>     validate (exit 0 ok, exit 1 with every issue)
 *   node validate.mjs --vocabulary          print the VideoSpec vocabulary (fonts, icons, presets, components)
 *   node validate.mjs --json <file>         the same as validate, as JSON on stdout
 *   node validate.mjs --notes <file>        validate, and also print the info notes (what the polish pass added)
 *
 * Contract: PLAN-CLAUDE-PLUGIN-ARTIFACT section 3 (elah-input.json, version 1); `kind: "page"` is PLAN-HTML-FIRST section 3.
 */
import { readFileSync } from 'node:fs'
import { AUTHORED_KINDS, buildVideo, specVocabulary } from '@elah/core/spec'
import { validateScene } from '@elah/core/html'
import { readProjectDocument } from '@elah-plugin/project-document'

const args = process.argv.slice(2)
const json = args.includes('--json')
const notes = args.includes('--notes')
const rest = args.filter((a) => a !== '--json' && a !== '--notes')

function usage() {
  process.stderr.write('usage: node validate.mjs <elah-input.json> [--json] [--notes]\n       node validate.mjs --vocabulary\n')
  process.exit(2)
}

if (rest[0] === '--vocabulary') {
  // The engine's KINDS line lists only the compiler's kinds; an authored file may also use component, system and vector.
  // `page` (source.kind, the programmatic video) leads the line: it is the default medium; the rest are VideoSpec element kinds.
  const vocabulary = specVocabulary()
    .split('\n')
    .map((line) =>
      line.startsWith('KINDS (element.kind):')
        ? `KINDS (source.kind "page", then VideoSpec element.kind, authored): page (programmatic video, the default), ${AUTHORED_KINDS.join(', ')}`
        : line,
    )
    .join('\n')
  process.stdout.write(vocabulary + '\n')
  process.exit(0)
}
if (rest.length !== 1 || rest[0].startsWith('--')) usage()

/** @type {{severity: 'error'|'warn'|'info', path: string, code?: string, message: string, substitute?: string}[]} */
const issues = []
const add = (severity, path, message, extra = {}) => issues.push({ severity, path, message, ...extra })
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const isPosNum = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0

function finish(summary) {
  const all = issues
  // Info notes (what the polish pass added) are noise in the terminal; --json and --notes keep them.
  const shown = json || notes ? all : all.filter((i) => i.severity !== 'info')
  const errors = all.filter((i) => i.severity === 'error')
  const ok = errors.length === 0
  if (json) {
    process.stdout.write(JSON.stringify({ ok, summary: ok ? summary : undefined, issues }, null, 2) + '\n')
  } else if (ok) {
    process.stdout.write(`OK: ${summary}\n`)
    for (const i of shown) process.stdout.write(`  ${i.severity}: ${i.path}: ${i.message}\n`)
  } else {
    process.stdout.write(`FAILED: ${errors.length} error${errors.length === 1 ? '' : 's'}`)
    const others = shown.filter((i) => i.severity === 'warn').length
    process.stdout.write(others ? ` and ${others} warning${others === 1 ? '' : 's'}\n` : '\n')
    for (const i of shown) {
      const sub = i.substitute ? ` (use instead: ${i.substitute})` : ''
      process.stdout.write(`  ${i.severity}: ${i.path}: ${i.message}${sub}\n`)
    }
  }
  process.exit(ok ? 0 : 1)
}

function projectLength(project) {
  let end = 0
  let clips = 0
  for (const bucket of Object.values(project.clips)) {
    for (const c of bucket) {
      clips++
      end = Math.max(end, c.startFrame + c.durationFrames)
    }
  }
  return { clips, seconds: end / project.fps }
}

// ---------------------------------------------------------------------------------------------------------------------------
// kind "page": one self-contained HTML + CSS page whose own CSS animations are the video (PLAN-HTML-FIRST sections 2-3).
// There is no DOM in Node, so these are string-level checks: a small tag tokenizer for the markup and a brace/paren-aware
// block parser for the CSS. They refuse what the artifact could not mount or seek; the artifact checks the rest.
// ---------------------------------------------------------------------------------------------------------------------------
const PAGE_FONTS = ['inter', 'montserrat', 'poppins', 'space-grotesk', 'playfair-display', 'dm-serif-display', 'oswald', 'roboto-mono', 'bebas-neue', 'anton', 'archivo-black', 'caveat']
const PAGE_FONT_OK = new Set([...PAGE_FONTS, 'sans-serif', 'serif', 'monospace', 'inherit', 'initial', 'unset', 'revert'])
const PAGE_HTML_MAX = 64 * 1024
const PAGE_CSS_MAX = 32 * 1024
const BANNED_TAGS = {
  iframe: 'an inline <svg> or plain elements; nothing can be embedded',
  object: 'an inline <svg> or plain elements; nothing can be embedded',
  embed: 'an inline <svg> or plain elements; nothing can be embedded',
  video: 'drawn elements; a programmatic video has no media files (footage is not part of it)',
  audio: 'nothing; a programmatic video is silent',
  link: 'the css field (no stylesheet or font links)',
  base: 'nothing; there is no network',
  style: 'the css field (a <style> tag would skip the CSS checks)',
  animate: 'CSS @keyframes (SMIL animation is not on the document timeline, so it cannot be seeked)',
  animatetransform: 'CSS @keyframes with transform',
  animatemotion: 'CSS @keyframes with transform',
  set: 'CSS @keyframes (SMIL animation is not on the document timeline, so it cannot be seeked)',
}
const TIME_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:ms|s)$/
const toSeconds = (t) => (t.endsWith('ms') ? parseFloat(t) / 1000 : parseFloat(t))
const ANIM_KEYWORDS = new Set(['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear', 'step-start', 'step-end', 'normal', 'reverse', 'alternate', 'alternate-reverse', 'none', 'forwards', 'backwards', 'both', 'running', 'paused', 'infinite'])

/** Split on a separator outside (), [] and quotes. */
function splitTop(text, sep) {
  const out = []
  let depth = 0
  let quote = ''
  let buf = ''
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
    else if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) {
      out.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  out.push(buf)
  return out.map((s) => s.trim()).filter((s) => s !== '')
}

/** Parse CSS into { prelude, decls, children } blocks. Braces and semicolons inside () and quotes do not count. */
function parseCss(text) {
  let i = 0
  const body = (prelude) => {
    const block = { prelude, decls: '', children: [] }
    let buf = ''
    let depth = 0
    let quote = ''
    while (i < text.length) {
      const ch = text[i]
      if (quote) {
        if (ch === quote) quote = ''
        buf += ch
        i++
      } else if (ch === '"' || ch === "'") {
        quote = ch
        buf += ch
        i++
      } else if (ch === '(') {
        depth++
        buf += ch
        i++
      } else if (ch === ')') {
        depth = Math.max(0, depth - 1)
        buf += ch
        i++
      } else if (depth > 0) {
        buf += ch
        i++
      } else if (ch === ';') {
        block.decls += `${buf};`
        buf = ''
        i++
      } else if (ch === '{') {
        i++
        const child = body(buf.trim())
        block.children.push(child)
        buf = ''
      } else if (ch === '}') {
        i++
        break
      } else {
        buf += ch
        i++
      }
    }
    if (buf.trim()) block.decls += buf
    return block
  }
  return body('')
}

function* walkBlocks(block) {
  for (const c of block.children) {
    yield c
    yield* walkBlocks(c)
  }
}

function declsOf(text) {
  const out = []
  for (const d of splitTop(text, ';')) {
    const k = d.indexOf(':')
    if (k > 0) out.push([d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim()])
  }
  return out
}

/** The animations one declaration block asks for: the shorthand, then the longhands laid over it by index. */
function animationsOf(decls, custom) {
  let list = []
  const longhand = {}
  let paused = false
  // var(--x) with a known custom property is replaced by its value, so a curve or time kept in a token is still read.
  const subst = (value) => {
    let v = value
    for (let k = 0; k < 4 && /var\(/i.test(v); k++) {
      v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/gi, (whole, name) => (custom.has(name) ? custom.get(name) : whole))
    }
    return v
  }
  for (const [prop, rawValue] of decls) {
    const value = subst(rawValue)
    if (prop === 'animation' || prop === '-webkit-animation') {
      list = splitTop(value, ',').map((item) => {
        const a = { name: '', duration: undefined, delay: 0, iterations: 1, fill: 'none', dynamic: false }
        for (const tok of splitTop(item, ' ')) {
          const t = tok.toLowerCase()
          if (/^(?:calc|var|min|max|clamp)\(/.test(t)) a.dynamic = true
          else if (TIME_RE.test(t)) {
            if (a.duration === undefined) a.duration = toSeconds(t)
            else a.delay = toSeconds(t)
          } else if (t === 'infinite') a.iterations = Infinity
          else if (/^(?:\d+\.?\d*|\.\d+)$/.test(t)) a.iterations = parseFloat(t)
          else if (['forwards', 'backwards', 'both'].includes(t)) a.fill = t
          else if (t === 'paused' || t === 'running') paused = true
          else if (!ANIM_KEYWORDS.has(t) && !t.startsWith('cubic-bezier(') && !t.startsWith('steps(') && !t.startsWith('linear(')) a.name = tok
        }
        return a
      })
    } else if (['animation-name', 'animation-duration', 'animation-delay', 'animation-iteration-count', 'animation-fill-mode'].includes(prop)) {
      longhand[prop] = splitTop(value, ',')
    }
  }
  const n = Math.max(list.length, ...Object.values(longhand).map((v) => v.length), 0)
  const at = (arr, k) => (arr && arr.length ? arr[k % arr.length] : undefined)
  const out = []
  for (let k = 0; k < n; k++) {
    const a = { ...(list[k] ?? { name: '', duration: undefined, delay: 0, iterations: 1, fill: 'none', dynamic: false }) }
    const name = at(longhand['animation-name'], k)
    if (name !== undefined && name !== 'none') a.name = name
    const dur = at(longhand['animation-duration'], k)
    if (dur !== undefined && TIME_RE.test(dur)) a.duration = toSeconds(dur)
    else if (dur !== undefined) a.dynamic = true
    const delay = at(longhand['animation-delay'], k)
    if (delay !== undefined && TIME_RE.test(delay)) a.delay = toSeconds(delay)
    else if (delay !== undefined) a.dynamic = true
    const it = at(longhand['animation-iteration-count'], k)
    if (it !== undefined) a.iterations = it === 'infinite' ? Infinity : parseFloat(it) || 1
    const fill = at(longhand['animation-fill-mode'], k)
    if (fill !== undefined) a.fill = fill.toLowerCase()
    if (a.name && a.name !== 'none') out.push(a)
  }
  return { animations: out, paused }
}

/** Check one CSS text (the css field, or a style="" attribute). `isBlock` is true for an attribute (declarations only). */
function checkCssText(path, rawText, isBlock, ctx) {
  const text = rawText.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const first = (re) => (text.match(re) ?? [])[0]
  if (/@import\b/i.test(text)) add('error', path, '@import fetches over the network', { substitute: 'put the rules in this css field' })
  if (/@font-face\b/i.test(text)) add('error', path, '@font-face is not allowed (no network, no embedded fonts)', { substitute: `font-family: one of ${PAGE_FONTS.join(', ')}` })
  if (/(?:^|[;{\s])(?:-webkit-)?transition(?:-[a-z-]+)?\s*:/i.test(text)) {
    add('error', path, 'transition never runs (nothing triggers it, and the video clock does not hover or click)', {
      substitute: '@keyframes plus animation with an explicit duration and delay in seconds',
    })
  }
  if (/animation-play-state\s*:/i.test(text)) add('error', path, 'animation-play-state must not be authored (the player pauses and seeks every animation itself)', { substitute: 'animation-delay to start later; remove the property' })
  if (/animation-timeline\s*:/i.test(text)) add('error', path, 'animation-timeline (scroll or view timelines) is not the document clock, so it cannot be seeked', { substitute: 'a normal duration-based animation' })
  if (/(?:^|[;{\s])font\s*:/i.test(text)) add('error', path, `the font shorthand hides the family (${first(/(?:^|[;{\s])font\s*:[^;}]*/i)?.trim()})`, { substitute: 'font-family, font-size and font-weight as separate properties' })
  for (const m of text.matchAll(/url\(\s*(['"]?)\s*([^)'"]*)/gi)) {
    const target = m[2].trim()
    if (!/^data:/i.test(target) && !target.startsWith('#')) {
      add('error', path, `url(${target.slice(0, 40)}${target.length > 40 ? '...' : ''}) points outside the video (no network)`, { substitute: 'a data: URI, a #fragment reference to an inline <svg> def, or a gradient' })
    }
  }
  const root = isBlock ? { prelude: '', decls: text, children: [] } : parseCss(text)
  const blocks = [root, ...walkBlocks(root)]
  for (const b of blocks) {
    const sel = b.prelude
    if (/^@font-face/i.test(b.prelude)) continue // already refused above
    const kf = /^@(?:-webkit-)?keyframes\s+(.+)$/i.exec(b.prelude)
    if (kf) {
      ctx.defined.add(kf[1].trim().replace(/^["']|["']$/g, ''))
      ctx.keyframes++
      continue
    }
    if (!b.prelude.startsWith('@') && /^(?:\d+(?:\.\d+)?%|from|to)(?:\s*,\s*(?:\d+(?:\.\d+)?%|from|to))*$/i.test(b.prelude)) continue // a keyframe step
    for (const part of b.prelude.split(',')) {
      if (/^(?:html|body|:root)(?![\w-])/i.test(part.trim())) {
        add('warn', `${path} ${part.trim()}`, 'html, body and :root do not match inside the video stage', { substitute: 'put the rules and custom properties on your root element, for example .stage' })
      }
    }
    const decls = declsOf(b.decls)
    for (const [prop, value] of decls) {
      if (prop === 'font-family') ctx.fontLists.push({ path: `${path} ${sel}`.trim(), value })
      else if (prop.startsWith('--')) ctx.custom.set(prop, value)
    }
    const { animations, paused } = animationsOf(decls, ctx.custom)
    if (paused) add('error', `${path} ${sel}`.trim(),'animation-play-state (paused or running) must not be authored, not even inside the animation shorthand', { substitute: 'remove the keyword' })
    const hidesFirst = decls.some(([p, v]) => (p === 'opacity' && parseFloat(v) === 0) || (p === 'visibility' && /^hidden/i.test(v)))
    for (const a of animations) {
      ctx.used.add(a.name)
      ctx.animations++
      const where = `${path} ${sel} { animation: ${a.name} }`.replace('  ', ' ')
      if (a.duration === undefined && !a.dynamic) {
        add('warn', where, 'the animation has no explicit duration, so it lasts 0 s and never plays', { substitute: 'a duration in seconds, e.g. animation: name 0.6s cubic-bezier(...) 1.2s both' })
      } else if (a.duration !== undefined && !a.dynamic) {
        const end = a.delay + a.duration * (Number.isFinite(a.iterations) ? a.iterations : 1)
        if (Number.isFinite(a.iterations) && end > ctx.duration + 0.05) {
          add('warn', where, `it ends at ${end.toFixed(2)} s, after the video's ${ctx.duration} s end, so the last part is cut off`, { substitute: 'shorten its delay or duration, or lengthen durationSeconds' })
        }
      }
      if (a.iterations === Infinity) add('warn', where, 'infinite animation: allowed, and it runs for the whole video; Edit converts it unrolled. Keep it only if the loop is the point (craft rule: nothing moves after a title lands)')
      if ((a.delay > 0 || a.dynamic) && a.fill !== 'both' && a.fill !== 'backwards' && !hidesFirst) {
        add('warn', where, `${a.dynamic ? 'a computed delay' : `delay ${a.delay} s`} without fill-mode backwards or both: the element shows its resting style until the delay ends`, { substitute: 'animation-fill-mode: both' })
      }
    }
  }
}

function checkPage(src, title) {
  const html = src.html
  const css = src.css
  if (Buffer.byteLength(html, 'utf8') > PAGE_HTML_MAX) add('error', 'source.html', `markup is ${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} KB; the cap is 64 KB`, { substitute: 'fewer elements; repeat a pattern with one class instead of inline styles' })
  if (Buffer.byteLength(css, 'utf8') > PAGE_CSS_MAX) add('error', 'source.css', `CSS is ${(Buffer.byteLength(css, 'utf8') / 1024).toFixed(1)} KB; the cap is 32 KB`, { substitute: 'shared classes and custom properties instead of repeated declarations' })
  if (/<script/i.test(html)) add('error', 'source.html <script>', 'scripts are not allowed in a programmatic video', { substitute: 'CSS @keyframes and animation-delay for every movement' })
  if (/<(?:html|head|body)\b|<!doctype/i.test(html)) add('warn', 'source.html', 'html is a fragment inside the stage: <html>, <head>, <body> and <!doctype> are dropped', { substitute: 'one root element such as <main class="stage">' })

  const ctx = { defined: new Set(), used: new Set(), custom: new Map(), fontLists: [], animations: 0, keyframes: 0, duration: src.durationSeconds }
  const cssPieces = []
  let scenes = 0
  // custom properties first, so var(--ease) in an animation is read whichever rule comes first
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) ctx.custom.set(m[1], m[2].trim())
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g)) {
    if (m[1]) continue
    const tag = m[2].toLowerCase()
    if (BANNED_TAGS[tag]) add('error', `source.html <${tag}>`, `<${tag}> is not allowed`, { substitute: BANNED_TAGS[tag] })
    if (tag === 'meta' && /http-equiv/i.test(m[3])) add('error', 'source.html <meta http-equiv>', 'meta http-equiv can redirect or refresh the video', { substitute: 'nothing' })
    for (const a of m[3].matchAll(/([^\s=\/"'<>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g)) {
      const name = a[1].toLowerCase()
      const value = (a[2] ?? '').replace(/^["']|["']$/g, '')
      if (name === 'data-scene') scenes++
      if (/^on[a-z]+$/.test(name)) add('error', `source.html <${tag} ${name}>`, 'event-handler attributes are not allowed', { substitute: 'CSS animation (a programmatic video runs no script)' })
      else if (['src', 'href', 'xlink:href', 'poster', 'srcset', 'action', 'formaction'].includes(name) && !/^\s*(?:data:|#)/i.test(value)) {
        add('error', `source.html <${tag} ${name}>`, `${name}="${value.slice(0, 40)}" points outside the video (no network)`, { substitute: 'a data: URI, or draw it with elements and inline <svg>' })
      } else if (name === 'style') cssPieces.push(value)
      else if (name === 'font-family') ctx.fontLists.push({ path: `source.html <${tag} font-family>`, value })
      else if (/url\(/i.test(value)) cssPieces.push(`x{v:${value}}`)
    }
  }
  checkCssText('source.css', css, false, ctx)
  for (const piece of cssPieces) checkCssText('source.html style=""', piece, /^x\{/.test(piece) ? false : true, ctx)

  const resolve = (value, depth = 0) => {
    const items = []
    for (const raw of splitTop(value, ',')) {
      const v = /^var\(\s*(--[\w-]+)/i.exec(raw)
      if (v) {
        const target = ctx.custom.get(v[1])
        if (target !== undefined && depth < 4) items.push(...resolve(target, depth + 1))
      } else items.push(raw.replace(/^["']|["']$/g, '').trim().toLowerCase())
    }
    return items
  }
  for (const f of ctx.fontLists) {
    const bad = resolve(f.value).filter((id) => id && !PAGE_FONT_OK.has(id))
    if (bad.length) add('error', f.path, `font-family ${bad.join(', ')} is not a bundled font`, { substitute: `one of ${PAGE_FONTS.join(', ')} (sans-serif, serif or monospace only as a last fallback)` })
  }
  for (const n of ctx.used) if (!ctx.defined.has(n)) add('warn', 'source.css', `animation "${n}" has no @keyframes ${n}, so it does nothing`, { substitute: `define @keyframes ${n} { ... }, or fix the name` })
  for (const n of ctx.defined) if (!ctx.used.has(n)) add('warn', 'source.css', `@keyframes ${n} is defined but no animation uses it`, { substitute: 'use it in an animation, or delete it' })
  if (scenes === 0) add('warn', 'source.html', 'no [data-scene] element: the timeline and the Edit report cannot name the scenes', { substitute: 'give each scene root a data-scene="name" attribute' })
  return { scenes, animations: ctx.animations, keyframes: ctx.keyframes }
}

let doc
try {
  // A UTF-8 byte-order mark (Windows editors and PowerShell add one) is not valid JSON, so drop it.
  doc = JSON.parse(readFileSync(rest[0], 'utf8').replace(/^﻿/, ''))
} catch (e) {
  add('error', '(file)', `cannot read ${rest[0]} as JSON: ${e instanceof Error ? e.message : String(e)}`)
  finish('')
}

if (!isObj(doc)) {
  add('error', '(root)', 'the file must hold one JSON object')
  finish('')
}
if (doc.format !== 'elah-input') add('error', 'format', 'must be the string "elah-input"')
if (doc.version !== 1) add('error', 'version', 'must be the number 1')
if (doc.title !== undefined && typeof doc.title !== 'string') add('error', 'title', 'must be a string')
if (!isObj(doc.source)) {
  add('error', 'source', 'must be an object with kind "page" (programmatic video, the default), "spec", "html" or "project"')
  finish('')
}

const src = doc.source
const title = typeof doc.title === 'string' ? doc.title : '(untitled)'

if (src.kind === 'spec') {
  const spec = src.spec
  if (!isObj(spec)) {
    add('error', 'source.spec', 'must be a VideoSpec object')
    finish('')
  }
  if (!isObj(spec.format) || !isPosNum(spec.format.width) || !isPosNum(spec.format.height) || !isPosNum(spec.format.fps)) {
    add('error', 'source.spec.format', 'must be { width, height, fps } with positive numbers')
  }
  if (!isPosNum(spec.duration)) add('error', 'source.spec.duration', 'must be a positive number of seconds')
  if (!Array.isArray(spec.elements) || spec.elements.length === 0) add('error', 'source.spec.elements', 'must be a non-empty array')
  if (issues.length) finish('')
  let built
  try {
    built = buildVideo(spec, { seed: 1 })
  } catch (e) {
    add('error', 'source.spec', `the compiler threw: ${e instanceof Error ? e.message : String(e)}`)
    finish('')
  }
  for (const i of built.issues) add(i.severity, `source.spec.${i.path}`, `${i.message}${i.code ? ` [${i.code}]` : ''}`)
  const { clips, seconds } = projectLength(built.project)
  const f = spec.format
  finish(`spec "${title}", ${f.width}x${f.height} @ ${f.fps} fps, ${seconds.toFixed(1)} s, ${clips} clips, ${built.fontIds.length} fonts`)
} else if (src.kind === 'html') {
  if (typeof src.html !== 'string' || src.html.trim() === '') add('error', 'source.html', 'must be a non-empty HTML string')
  if (typeof src.css !== 'string') add('error', 'source.css', 'must be a string (use "" for none)')
  if (!isPosNum(src.durationSeconds)) add('error', 'source.durationSeconds', 'must be a positive number')
  if (!isObj(src.stage) || !isPosNum(src.stage.width) || !isPosNum(src.stage.height)) add('error', 'source.stage', 'must be { width, height }')
  if (!Number.isInteger(src.fps) || src.fps < 1) add('error', 'source.fps', 'must be a positive integer')
  if (issues.length) finish('')
  const report = validateScene({ html: src.html, css: src.css })
  for (const v of report.violations) {
    const where = v.property ? `${v.element} { ${v.property}${v.value ? `: ${v.value}` : ''} }` : v.element
    add('error', `source.html ${where}`, v.message, v.substitute ? { substitute: v.substitute } : {})
  }
  add('info', 'source.html', 'only the HTML/CSS subset was checked here; layout and data-motion clauses are measured and converted in the artifact page')
  finish(`html scene "${title}", ${src.stage.width}x${src.stage.height} @ ${src.fps} fps, ${src.durationSeconds} s, subset check passed`)
} else if (src.kind === 'page') {
  if (typeof src.html !== 'string' || src.html.trim() === '') add('error', 'source.html', 'must be a non-empty HTML string')
  if (typeof src.css !== 'string') add('error', 'source.css', 'must be a string (use "" for none)')
  if (!isPosNum(src.durationSeconds)) add('error', 'source.durationSeconds', 'must be a positive number of seconds')
  if (!isObj(src.stage) || !Number.isInteger(src.stage.width) || !Number.isInteger(src.stage.height) || src.stage.width < 1 || src.stage.height < 1) {
    add('error', 'source.stage', 'must be { width, height } with positive integers, e.g. { "width": 1920, "height": 1080 }')
  }
  if (!Number.isInteger(src.fps) || src.fps < 24 || src.fps > 60) add('error', 'source.fps', 'must be an integer from 24 to 60')
  if (issues.length) finish('')
  const stats = checkPage(src, title)
  add('info', 'source.html', 'only string-level checks ran here (no DOM in Node); the artifact mounts the programmatic video, seeks every animation and reports what it cannot draw')
  finish(`programmatic video "${title}", ${src.stage.width}x${src.stage.height} @ ${src.fps} fps, ${src.durationSeconds} s, ${stats.scenes} scenes, ${stats.animations} animations, ${stats.keyframes} keyframe sets`)
} else if (src.kind === 'project') {
  if (!isObj(src.project)) {
    add('error', 'source.project', 'must be a .elah.json Project document object')
    finish('')
  }
  try {
    const project = readProjectDocument(src.project)
    const { clips, seconds } = projectLength(project)
    finish(`project "${title}", ${project.stage.width}x${project.stage.height} @ ${project.fps} fps, ${seconds.toFixed(1)} s, ${clips} clips`)
  } catch (e) {
    add('error', 'source.project', e instanceof Error ? e.message : String(e))
    finish('')
  }
} else {
  add('error', 'source.kind', `must be "page" (programmatic video, the default), "spec", "html" or "project", got ${JSON.stringify(src.kind)}`)
  finish('')
}
