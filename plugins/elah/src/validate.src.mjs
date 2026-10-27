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
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { AUTHORED_KINDS, SFX_CUE_SYNONYMS, buildVideo, specVocabulary } from '@elah/core/spec'
import { validateScene } from '@elah/core/html'
import { readProjectDocument } from '@elah-plugin/project-document'
// The bundled CC0 sound pack's cue words (TICKET-PF-12); esbuild inlines the JSON.
import sfxPack from '../../../artifact/sfx/sfx.json'

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
// Supplied images (a logo, product shots, screenshots) sit as files in <work>/assets/ beside the input and are referenced
// as assets/<name> (or ./assets/<name>). The Artifact publish caps one binary file at 15 MB and one call at 64 MB; the
// page and engine take the rest, so the images together stay under 40 MB.
const ASSET_FILE_MAX = 15 * 1024 * 1024
const ASSET_TOTAL_MAX = 40 * 1024 * 1024
const ASSET_REF = /^(?:\.\/)?assets\/([A-Za-z0-9][A-Za-z0-9._-]*)$/
const ASSET_TYPES = { png: 'PNG', jpg: 'JPEG', jpeg: 'JPEG', webp: 'WebP', svg: 'SVG' }
/** `assets/logo.png` or `./assets/logo.png` -> `logo.png`; anything else (other folders, `..`, absolute) -> undefined. */
const assetName = (ref) => {
  const m = ASSET_REF.exec(ref.trim())
  return m && !m[1].includes('..') ? m[1] : undefined
}
/** A relative or absolute file path (no scheme): only assets/<name> is accepted, so this one escapes or names another folder. */
const looksLocal = (ref) => {
  const r = ref.trim()
  return r !== '' && (/^[a-z]:[\\/]/i.test(r) || (!/^[a-z][a-z0-9+.-]*:/i.test(r) && !r.startsWith('//')))
}
const ASSET_SUBSTITUTE = 'a file the person supplied, copied into the assets/ folder beside the input and referenced as assets/<name>'
const BANNED_TAGS = {
  iframe: 'an inline <svg> or plain elements; nothing can be embedded',
  object: 'an inline <svg> or plain elements; nothing can be embedded',
  embed: 'an inline <svg> or plain elements; nothing can be embedded',
  video: 'drawn elements; a programmatic video has no media files (footage is not part of it)',
  audio: 'data-sfx="<cue>" on the element that lands (a pack word, or assets/sfx/<name>.mp3 from sfx-search.mjs); no other audio files',
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
    if (/^data:/i.test(target) || target.startsWith('#')) continue
    const shown = `${target.slice(0, 40)}${target.length > 40 ? '...' : ''}`
    const name = assetName(target)
    if (name) noteAsset(ctx, name, `${path} url(${target})`)
    else if (looksLocal(target)) {
      add('error', path, `url(${shown}) is not a file in the assets/ folder (no other folders, no "..", no absolute paths)`, { substitute: `url(assets/<name>): ${ASSET_SUBSTITUTE}` })
    } else {
      add('error', path, `url(${shown}) points outside the video (no network)`, { substitute: 'a data: URI, a #fragment reference to an inline <svg> def, a gradient, or url(assets/<name>) for a supplied image' })
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

function noteAsset(ctx, name, where) {
  if (!ctx.assets.has(name)) ctx.assets.set(name, where)
}

/** The first bytes of a file, to check it is the image type its extension says. */
function headOf(file, n = 512) {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(n)
    const got = readSync(fd, buf, 0, n, 0)
    return buf.subarray(0, got)
  } finally {
    closeSync(fd)
  }
}

function sniff(head, ext) {
  if (ext === 'png') return head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (ext === 'jpg' || ext === 'jpeg') return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
  if (ext === 'webp') return head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP'
  if (ext === 'svg') return /<svg[\s>/]/i.test(head.toString('utf8'))
  return false
}

/** Every assets/<name> the video references must be a supported image file in <input folder>/assets/, within the limits. */
function checkAssets(refs, inputDir) {
  let total = 0
  let ok = 0
  const types = Object.keys(ASSET_TYPES).join(', ')
  for (const [name, where] of refs) {
    const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase()
    if (!ASSET_TYPES[ext]) {
      add('error', where, `assets/${name} is not a supported image type (${types})`, { substitute: 'convert the file to PNG, JPEG, WebP or SVG' })
      continue
    }
    const file = join(inputDir, 'assets', name)
    if (!existsSync(file) || !statSync(file).isFile()) {
      add('error', where, `assets/${name} does not exist: there is no file ${file}`, { substitute: `copy the supplied file into ${join(inputDir, 'assets')}, or fix the name (names are case-sensitive once published)` })
      continue
    }
    const size = statSync(file).size
    if (size > ASSET_FILE_MAX) {
      add('error', where, `assets/${name} is ${(size / 1048576).toFixed(1)} MB; one image may be at most 15 MB`, { substitute: 'a smaller export of the image (a 1920 px wide PNG or JPEG is plenty for a 1080p video)' })
      continue
    }
    if (!sniff(headOf(file), ext)) {
      add('error', where, `assets/${name} is not ${/^[SW]/.test(ASSET_TYPES[ext]) ? 'an' : 'a'} ${ASSET_TYPES[ext]} file (its contents do not match the .${ext} extension)`, { substitute: 'the real image file, or the extension that matches its contents' })
      continue
    }
    total += size
    ok++
  }
  if (total > ASSET_TOTAL_MAX) {
    add('error', 'source assets/', `the images add up to ${(total / 1048576).toFixed(1)} MB; together they may be at most 40 MB (the artifact publishes in one call)`, { substitute: 'fewer or smaller images' })
  }
  return { count: ok, bytes: total }
}

function checkPage(src, title, inputDir) {
  const html = src.html
  const css = src.css
  if (Buffer.byteLength(html, 'utf8') > PAGE_HTML_MAX) add('error', 'source.html', `markup is ${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} KB; the cap is 64 KB`, { substitute: 'fewer elements; repeat a pattern with one class instead of inline styles' })
  if (Buffer.byteLength(css, 'utf8') > PAGE_CSS_MAX) add('error', 'source.css', `CSS is ${(Buffer.byteLength(css, 'utf8') / 1024).toFixed(1)} KB; the cap is 32 KB`, { substitute: 'shared classes and custom properties instead of repeated declarations' })
  if (/<script/i.test(html)) add('error', 'source.html <script>', 'scripts are not allowed in a programmatic video', { substitute: 'CSS @keyframes and animation-delay for every movement' })
  if (/<(?:html|head|body)\b|<!doctype/i.test(html)) add('warn', 'source.html', 'html is a fragment inside the stage: <html>, <head>, <body> and <!doctype> are dropped', { substitute: 'one root element such as <main class="stage">' })

  const ctx = { defined: new Set(), used: new Set(), custom: new Map(), fontLists: [], animations: 0, keyframes: 0, duration: src.durationSeconds, assets: new Map() }
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
        const linkable = ['src', 'href', 'xlink:href'].includes(name)
        const asset = linkable ? assetName(value) : undefined
        if (asset) noteAsset(ctx, asset, `source.html <${tag} ${name}="${value.trim()}">`)
        else if (linkable && looksLocal(value)) {
          add('error', `source.html <${tag} ${name}>`, `${name}="${value.slice(0, 40)}" is not a file in the assets/ folder (no other folders, no "..", no absolute paths)`, { substitute: `${name}="assets/<name>": ${ASSET_SUBSTITUTE}` })
        } else {
          add('error', `source.html <${tag} ${name}>`, `${name}="${value.slice(0, 40)}" points outside the video (no network)`, { substitute: 'a data: URI, draw it with elements and inline <svg>, or src="assets/<name>" for a supplied image' })
        }
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
  const assets = checkAssets(ctx.assets, inputDir)
  const cues = checkCues(html, css, src.durationSeconds, inputDir)
  return { scenes, animations: ctx.animations, keyframes: ctx.keyframes, assets, cues }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Sound cues (TICKET-PF-13): data-sfx="<cue>" on an element plays a sound from the bundled CC0 pack (artifact/sfx/sfx.json)
// at that element's first animation start. The artifact reads the exact time from the mounted page; here a small cascade
// (simple selectors, custom properties, calc() delays) estimates it, so two cues closer than 0.25 s can be warned about.
// ---------------------------------------------------------------------------------------------------------------------------
const SFX_WORDS = Object.keys(sfxPack.cues)
const SFX_OK = new Set([...SFX_WORDS, ...Object.keys(SFX_CUE_SYNONYMS)])
const SFX_MAX = 24
// A searched sound (TICKET-PF-12b): one mp3 directly in assets/sfx/, at most 2 MB, starting with an MP3 frame or ID3.
const SFX_FILE = /^(?:\.\/)?assets\/sfx\/([A-Za-z0-9][A-Za-z0-9._-]*\.mp3)$/i
const SFX_FILE_MAX = 2 * 1048576

/** Check a searched-sound path against <input folder>. Reports through add(); returns true when it is usable. */
function checkSfxFile(ref, inputDir, where) {
  const m = SFX_FILE.exec(ref.trim())
  if (!m || m[1].includes('..')) {
    add('error', where, `"${ref}" is not a file in assets/sfx/ (one folder level, an .mp3 name, no "..", no absolute paths)`, { substitute: 'assets/sfx/<name>.mp3 as written by sfx-search.mjs, or one of the pack words' })
    return false
  }
  const file = join(inputDir, 'assets', 'sfx', m[1])
  if (!existsSync(file) || !statSync(file).isFile()) {
    add('error', where, `assets/sfx/${m[1]} does not exist: there is no file ${file}`, { substitute: 'run sfx-search.mjs with --pick to download it, or fix the name (names are case-sensitive once published)' })
    return false
  }
  const size = statSync(file).size
  if (size > SFX_FILE_MAX) {
    add('error', where, `assets/sfx/${m[1]} is ${(size / 1048576).toFixed(1)} MB; one sound may be at most 2 MB`, { substitute: 'a shorter sound (sfx-search.mjs keeps to 3 s)' })
    return false
  }
  const head = headOf(file)
  const mp3 = head.length >= 3 && (head.toString('latin1', 0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0))
  if (!mp3) {
    add('error', where, `assets/sfx/${m[1]} is not an MP3 file (its contents do not start with an MP3 frame or ID3 tag)`, { substitute: 'the real mp3 from sfx-search.mjs' })
    return false
  }
  return true
}
const SFX_MIN_GAP = 0.25
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])

/** A minimal element tree from the markup (tag, id, classes, attributes, parent, children). */
function elementTree(html) {
  const root = { tag: '#root', attrs: new Map(), classes: new Set(), id: '', parent: null, children: [] }
  let cur = root
  const text = html.replace(/<!--[\s\S]*?-->/g, '')
  for (const m of text.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g)) {
    const tag = m[2].toLowerCase()
    if (m[1]) {
      for (let n = cur; n && n !== root; n = n.parent) {
        if (n.tag === tag) {
          cur = n.parent
          break
        }
      }
      continue
    }
    const attrs = new Map()
    for (const a of m[3].matchAll(/([^\s=\/"'<>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g)) attrs.set(a[1].toLowerCase(), (a[2] ?? '').replace(/^["']|["']$/g, ''))
    const node = { tag, attrs, classes: new Set((attrs.get('class') ?? '').split(/\s+/).filter(Boolean)), id: attrs.get('id') ?? '', parent: cur, children: [] }
    cur.children.push(node)
    if (!VOID_TAGS.has(tag) && !/\/\s*$/.test(m[3])) cur = node
  }
  return root
}

/** One compound selector (`p.hero#x[data-a]:nth-child(2)`) -> its parts, or null when it names a pseudo-element. */
function parseCompound(s) {
  if (/::|:(?:before|after|first-line|first-letter)\b/i.test(s)) return null
  const c = { tag: '', id: '', classes: [], attrs: [] }
  const re = /\[\s*([\w:-]+)\s*(?:=\s*("[^"]*"|'[^']*'|[^\]\s]+))?\s*\]|:[\w-]+(?:\([^)]*\))?|([.#]?)(-?[\w-]+|\*)/g
  let any = false
  for (const m of s.matchAll(re)) {
    any = true
    if (m[1]) c.attrs.push([m[1].toLowerCase(), m[2] === undefined ? undefined : m[2].replace(/^["']|["']$/g, '')])
    else if (m[0].startsWith(':')) continue // a pseudo-class: matched optimistically
    else if (m[3] === '.') c.classes.push(m[4])
    else if (m[3] === '#') c.id = m[4]
    else if (m[4] !== '*') c.tag = m[4].toLowerCase()
  }
  return any ? c : null
}

const compoundMatches = (c, n) =>
  (!c.tag || c.tag === n.tag) && (!c.id || c.id === n.id) && c.classes.every((k) => n.classes.has(k)) &&
  c.attrs.every(([k, v]) => n.attrs.has(k) && (v === undefined || n.attrs.get(k) === v))

/** A complex selector with descendant and child combinators; `+` and `~` are not followed (no match). */
function parseSelector(sel) {
  if (/[+~]/.test(sel.replace(/\([^)]*\)|\[[^\]]*\]/g, ''))) return null
  const parts = sel.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/)
  const chain = []
  let comb = ' '
  for (const p of parts) {
    if (p === '>') {
      comb = '>'
      continue
    }
    const c = parseCompound(p)
    if (!c) return null
    chain.push({ c, comb })
    comb = ' '
  }
  if (!chain.length) return null
  const spec = chain.reduce((s, { c }) => [s[0] + (c.id ? 1 : 0), s[1] + c.classes.length + c.attrs.length, s[2] + (c.tag ? 1 : 0)], [0, 0, 0])
  return { chain, spec: spec[0] * 10000 + spec[1] * 100 + spec[2] }
}

function selectorMatches(chain, node) {
  const match = (i, n) => {
    if (!compoundMatches(chain[i].c, n)) return false
    if (i === 0) return true
    if (chain[i].comb === '>') return !!n.parent && n.parent.tag !== '#root' && match(i - 1, n.parent)
    for (let p = n.parent; p && p.tag !== '#root'; p = p.parent) if (match(i - 1, p)) return true
    return false
  }
  return match(chain.length - 1, node)
}

/** Style rules of the css field in source order (inside @media too; @keyframes steps skipped). */
function styleRules(css) {
  const out = []
  const visit = (block) => {
    for (const b of block.children) {
      if (/^@(?:-webkit-)?keyframes\b/i.test(b.prelude) || /^@font-face/i.test(b.prelude)) continue
      if (b.prelude.startsWith('@')) {
        visit(b)
        continue
      }
      const decls = declsOf(b.decls)
      for (const part of splitTop(b.prelude, ',')) {
        const s = parseSelector(part)
        if (s) out.push({ ...s, order: out.length, decls })
      }
    }
  }
  visit(parseCss(css.replace(/\/\*[\s\S]*?\*\//g, ' ')))
  return out
}

/** `0.4s`, `-150ms` or `calc(0s + 2 * 0.1s)` (vars already substituted) -> seconds, or undefined. */
function evalTime(expr) {
  const e = expr.trim()
  if (TIME_RE.test(e)) return toSeconds(e)
  const m = /^calc\((.*)\)$/i.exec(e)
  if (!m) return undefined
  const body = m[1].replace(/((?:\d+\.?\d*|\.\d+))(ms|s)\b/g, (_all, n, unit) => `(${unit === 'ms' ? Number(n) / 1000 : Number(n)})`).replace(/calc\(/gi, '(')
  if (!/^[\d\s.+\-*/()eE]*$/.test(body)) return undefined
  try {
    const v = Function(`"use strict"; return (${body})`)()
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined
  } catch {
    return undefined
  }
}

/** The start (delay, seconds) of each finite animation one element's cascaded declarations ask for; undefined = unreadable. */
function animationStarts(decls, custom) {
  const subst = (value) => {
    let v = value
    for (let k = 0; k < 6 && /var\(/i.test(v); k++) {
      v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/gi, (whole, name, fb) => (custom.has(name) ? custom.get(name) : fb !== undefined ? fb.trim() : whole))
    }
    return v
  }
  let items = []
  const long = {}
  for (const [prop, raw] of decls) {
    const value = subst(raw)
    if (prop === 'animation' || prop === '-webkit-animation') {
      items = splitTop(value, ',').map((item) => {
        const a = { name: '', times: [], infinite: false }
        for (const tok of splitTop(item, ' ')) {
          const t = tok.toLowerCase()
          if (TIME_RE.test(t) || /^calc\(/.test(t)) a.times.push(evalTime(tok))
          else if (t === 'infinite') a.infinite = true
          else if (!ANIM_KEYWORDS.has(t) && !/^(?:cubic-bezier|steps|linear|var)\(/.test(t) && !/^(?:\d+\.?\d*|\.\d+)$/.test(t)) a.name = tok
        }
        return { name: a.name, delay: a.times.length > 1 ? a.times[1] : 0, infinite: a.infinite }
      })
    } else if (prop === 'animation-delay') long.delays = splitTop(value, ',').map(evalTime)
    else if (prop === 'animation-name') long.names = splitTop(value, ',')
    else if (prop === 'animation-iteration-count') long.iter = splitTop(value, ',')
  }
  const n = Math.max(items.length, long.names?.length ?? 0)
  const out = []
  for (let k = 0; k < n; k++) {
    const a = { ...(items[k] ?? { name: '', delay: 0, infinite: false }) }
    if (long.names) a.name = long.names[k % long.names.length]
    if (long.delays) a.delay = long.delays[k % long.delays.length]
    if (long.iter) a.infinite = long.iter[k % long.iter.length].trim() === 'infinite'
    if (a.name && a.name !== 'none' && !a.infinite) out.push(a.delay)
  }
  return out
}

/** Check every data-sfx cue: the word, the gain, how many, how close together. Returns the number of cues. */
function checkCues(html, css, duration, inputDir) {
  const root = elementTree(html)
  const rules = styleRules(css)
  const cues = []
  const visit = (node, inherited) => {
    let first = Infinity
    let unreadable = false
    let scope = inherited
    if (node.tag !== '#root') {
      const matched = rules.filter((r) => selectorMatches(r.chain, node)).sort((a, b) => a.spec - b.spec || a.order - b.order)
      const decls = [...matched.flatMap((r) => r.decls), ...declsOf(node.attrs.get('style') ?? '')]
      scope = new Map(inherited)
      for (const [p, v] of decls) if (p.startsWith('--')) scope.set(p, v)
      for (const d of animationStarts(decls, scope)) {
        if (d === undefined) unreadable = true
        else first = Math.min(first, d)
      }
    }
    for (const c of node.children) {
      const r = visit(c, scope)
      first = Math.min(first, r.first)
      unreadable = unreadable || r.unreadable
    }
    if (node.attrs.has('data-sfx')) {
      const word = node.attrs.get('data-sfx').trim().toLowerCase()
      const label = node.attrs.get('data-scene') ? `scene "${node.attrs.get('data-scene')}"` : `<${node.tag}${node.id ? `#${node.id}` : ''}${[...node.classes].slice(0, 2).map((c) => `.${c}`).join('')}>`
      const where = `source.html ${label} data-sfx="${word}"`
      const isPath = word.includes('/') || word.startsWith('assets')
      if (isPath) {
        // A searched sound (TICKET-PF-12b): assets/sfx/<name>.mp3 beside the input, written by sfx-search.mjs.
        checkSfxFile(word, inputDir, where)
      }
      if (!SFX_OK.has(word) && !isPath) {
        add('error', where, `"${word}" is not a sound in the bundled pack`, { substitute: `one of ${SFX_WORDS.join(', ')}, or a searched sound: node sfx-search.mjs "<query>" --out <work folder>, then data-sfx="assets/sfx/<name>.mp3"` })
      } else {
        const gain = node.attrs.get('data-sfx-gain')
        if (gain !== undefined && !(gain.trim() !== '' && Number(gain) >= 0 && Number(gain) <= 1)) {
          add('warn', where, `data-sfx-gain="${gain}" is not a number from 0 to 1, so the default loudness (0.6) is used`, { substitute: 'data-sfx-gain="0.5" (0 silent, 1 full)' })
        }
        let at
        if (Number.isFinite(first)) at = Math.min(Math.max(0, first), duration)
        else if (!unreadable) {
          at = 0
          add('warn', where, 'the element has no animation, so the sound plays at 0 s', { substitute: 'put data-sfx on the element whose arrival the sound marks' })
        }
        cues.push({ word, at, where })
      }
    }
    return { first, unreadable }
  }
  visit(root, new Map())
  if (cues.length > SFX_MAX) add('warn', 'source.html data-sfx', `${cues.length} sound cues; more than ${SFX_MAX} turns the video into noise`, { substitute: 'cues only where something lands: arrivals, impacts, the call to action; at most one per beat' })
  const timed = cues.filter((c) => c.at !== undefined).sort((a, b) => a.at - b.at)
  for (let k = 1; k < timed.length; k++) {
    const a = timed[k - 1]
    const b = timed[k]
    if (b.at - a.at < SFX_MIN_GAP - 1e-9) {
      add('warn', b.where, `plays at ${b.at.toFixed(2)} s, ${Math.round((b.at - a.at) * 1000)} ms after "${a.word}" at ${a.at.toFixed(2)} s; two cues closer than ${SFX_MIN_GAP} s blur into one`, { substitute: 'keep one of them, or move one cue to the next landing' })
    }
  }
  const untimed = cues.filter((c) => c.at === undefined)
  if (untimed.length) add('info', 'source.html data-sfx', `${untimed.length} cue time(s) could not be read here (${untimed.map((c) => c.word).join(', ')}); the artifact reads them from the running page`)
  return cues.length
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
  // A searched sound (TICKET-PF-12b): an sfx cue that is a path must be a file in assets/sfx/ beside the input.
  ;(built.expandedSpec?.sfx ?? []).forEach((c, i) => {
    const cue = String(c.cue ?? '').trim()
    if (cue.includes('/') || /^assets/i.test(cue)) checkSfxFile(cue, dirname(resolve(rest[0])), `source.spec.sfx[${i}] "${cue}"`)
  })
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
  const stats = checkPage(src, title, dirname(resolve(rest[0])))
  add('info', 'source.html', 'only string-level checks ran here (no DOM in Node); the artifact mounts the programmatic video, seeks every animation and reports what it cannot draw')
  const images = stats.assets.count ? `, ${stats.assets.count} image${stats.assets.count === 1 ? '' : 's'} in assets/ (${stats.assets.bytes >= 1048576 ? `${(stats.assets.bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(stats.assets.bytes / 1024))} KB`})` : ''
  finish(`programmatic video "${title}", ${src.stage.width}x${src.stage.height} @ ${src.fps} fps, ${src.durationSeconds} s, ${stats.scenes} scenes, ${stats.animations} animations, ${stats.keyframes} keyframe sets${images}${stats.cues ? `, ${stats.cues} sound cue${stats.cues === 1 ? '' : 's'}` : ''}`)
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
