/**
 * Source of plugins/elah/scripts/validate.mjs. Do not run this file: `node plugins/elah/build.mjs`
 * bundles it with the engine's spec compiler and HTML-subset validator into one plain-Node script.
 *
 *   node validate.mjs <elah-input.json>     validate (exit 0 ok, exit 1 with every issue)
 *   node validate.mjs --vocabulary          print the VideoSpec vocabulary (fonts, icons, presets, components)
 *   node validate.mjs --json <file>         the same as validate, as JSON on stdout
 *
 * Contract: PLAN-CLAUDE-PLUGIN-ARTIFACT section 3 (elah-input.json, version 1).
 */
import { readFileSync } from 'node:fs'
import { buildVideo, specVocabulary } from '@elah/core/spec'
import { validateScene } from '@elah/core/html'
import { readProjectDocument } from '@elah-plugin/project-document'

const args = process.argv.slice(2)
const json = args.includes('--json')
const rest = args.filter((a) => a !== '--json')

function usage() {
  process.stderr.write('usage: node validate.mjs <elah-input.json> [--json]\n       node validate.mjs --vocabulary\n')
  process.exit(2)
}

if (rest[0] === '--vocabulary') {
  process.stdout.write(specVocabulary() + '\n')
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
  // Info notes (what the polish pass added) are noise in the terminal; --json keeps them.
  const shown = json ? all : all.filter((i) => i.severity !== 'info')
  const errors = all.filter((i) => i.severity === 'error')
  const ok = errors.length === 0
  if (json) {
    process.stdout.write(JSON.stringify({ ok, summary: ok ? summary : undefined, issues }, null, 2) + '\n')
  } else if (ok) {
    process.stdout.write(`OK: ${summary}\n`)
    for (const i of shown) process.stdout.write(`  ${i.severity}: ${i.path}: ${i.message}\n`)
  } else {
    process.stdout.write(`FAILED: ${errors.length} error${errors.length === 1 ? '' : 's'}`)
    const others = shown.length - errors.length
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
  add('error', 'source', 'must be an object with kind "spec", "html" or "project"')
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
  add('error', 'source.kind', `must be "spec", "html" or "project", got ${JSON.stringify(src.kind)}`)
  finish('')
}
