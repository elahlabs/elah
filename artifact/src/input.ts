/**
 * The `elah-input.json` contract (plan section 3) and its conversion to a `Project`.
 *
 *   { format: 'elah-input', version: 1, title, source: spec | html | project }
 *
 * Read order: inline `<script type="application/json" id="elah-input">` first, else `./elah-input.json`.
 * Every refusal or spec issue is kept verbatim in `issues` so the page can show it (and a user can paste it
 * back to Claude).
 */

import { readProjectDocument, ensureFonts, FONT_REGISTRY, type Project } from '@elah/core'
import { buildVideo, type AuthoredSpec, type SpecIssue } from '@elah/core/spec'
import { sceneToClip, validateScene, type SceneSource } from '@elah/core/html'
import { measureScene } from './measure'

export interface HtmlSource {
  kind: 'html'
  html: string
  css?: string
  durationSeconds?: number
  stage?: { width: number; height: number }
  fps?: number
}
export type InputSource =
  | { kind: 'spec'; spec: unknown }
  | HtmlSource
  | { kind: 'project'; project: unknown }

export interface ElahInput {
  format: 'elah-input'
  version: 1
  title?: string
  source: InputSource
}

export interface Issue {
  severity: 'error' | 'warn' | 'info'
  where: string
  message: string
}

export interface Converted {
  title: string
  kind: InputSource['kind']
  project: Project
  fps: number
  stage: { width: number; height: number }
  issues: Issue[]
  /** Spec the project came from, when kind is 'spec' (kept as the project's `authored` field by buildVideo). */
  authored?: unknown
}

export class InputError extends Error {
  constructor(message: string, readonly issues: Issue[] = []) {
    super(message)
  }
}

export async function loadInput(): Promise<ElahInput> {
  let raw: unknown
  const inline = document.getElementById('elah-input')
  if (inline?.textContent?.trim()) {
    try {
      raw = JSON.parse(inline.textContent)
    } catch (e) {
      throw new InputError(`The inline #elah-input script is not valid JSON: ${(e as Error).message}`)
    }
  } else {
    let res: Response
    try {
      res = await fetch('./elah-input.json', { cache: 'no-store' })
    } catch (e) {
      throw new InputError(`Could not fetch ./elah-input.json: ${(e as Error).message}`)
    }
    if (!res.ok) throw new InputError(`Could not fetch ./elah-input.json (HTTP ${res.status}). Put an elah-input.json beside this page.`)
    try {
      raw = await res.json()
    } catch (e) {
      throw new InputError(`./elah-input.json is not valid JSON: ${(e as Error).message}`)
    }
  }
  return validateInput(raw)
}

export function validateInput(raw: unknown): ElahInput {
  const o = raw as Partial<ElahInput> | null
  if (!o || typeof o !== 'object') throw new InputError('elah-input must be a JSON object')
  if (o.format !== 'elah-input') throw new InputError(`elah-input.format must be "elah-input" (got ${JSON.stringify(o.format)})`)
  if (o.version !== 1) throw new InputError(`elah-input.version must be 1 (got ${JSON.stringify(o.version)})`)
  const s = o.source as InputSource | undefined
  if (!s || typeof s !== 'object') throw new InputError('elah-input.source is missing')
  if (s.kind !== 'spec' && s.kind !== 'html' && s.kind !== 'project') {
    throw new InputError(`elah-input.source.kind must be "spec", "html" or "project" (got ${JSON.stringify((s as { kind?: unknown }).kind)})`)
  }
  return o as ElahInput
}

/** Where the bundled fonts are served from: `fonts/` next to this page. */
export function fontBaseUrl(): string {
  return new URL('./fonts/', document.baseURI).href
}

export function loadAllFonts(): Promise<void> {
  return ensureFonts(
    FONT_REGISTRY.map((f) => f.id),
    { baseUrl: fontBaseUrl(), fonts: document.fonts, onWarning: (m) => console.warn(m) },
  ).then(() => document.fonts.ready).then(() => undefined)
}

const specIssue = (i: SpecIssue): Issue => ({ severity: i.severity, where: i.path, message: `${i.code}: ${i.message}` })

export async function convert(input: ElahInput): Promise<Converted> {
  const title = input.title?.trim() || 'Elah video'
  const src = input.source

  if (src.kind === 'project') {
    let project: Project
    try {
      project = readProjectDocument(src.project)
    } catch (e) {
      throw new InputError(`The project document could not be read: ${(e as Error).message}`)
    }
    return { title, kind: 'project', project, fps: project.fps, stage: project.stage, issues: [] }
  }

  if (src.kind === 'spec') {
    if (!src.spec || typeof src.spec !== 'object') throw new InputError('source.spec must be a VideoSpec object')
    const built = buildVideo(src.spec as AuthoredSpec)
    const issues = built.issues.map(specIssue)
    const errors = issues.filter((i) => i.severity === 'error')
    const hasClips = Object.values(built.project.clips).some((l) => l.length > 0)
    if (!hasClips) throw new InputError(`The spec compiled to an empty video (${errors.length} error(s)).`, issues)
    return { title, kind: 'spec', project: built.project, fps: built.project.fps, stage: built.project.stage, issues }
  }

  // html
  const css = src.css ?? ''
  const scene: SceneSource = { html: src.html, css }
  const verdict = validateScene(scene)
  const refusals: Issue[] = verdict.violations.map((v) => ({
    severity: 'error',
    where: v.element + (v.property ? ` { ${v.property}${v.value ? `: ${v.value}` : ''} }` : ''),
    message: v.message + (v.substitute ? ` Use instead: ${v.substitute}` : ''),
  }))
  if (!verdict.ok) throw new InputError('The HTML scene was refused by the converter.', refusals)

  const stage = src.stage ?? { width: 1920, height: 1080 }
  const fps = src.fps ?? 30
  await loadAllFonts()
  const measured = await measureScene(scene, { stage, fontsReady: loadAllFonts })
  if (typeof src.durationSeconds === 'number' && src.durationSeconds > 0) measured.duration = src.durationSeconds
  const { clip, report } = sceneToClip(measured, { fps })

  const issues: Issue[] = [...refusals]
  for (const s of report.skipped) issues.push({ severity: 'warn', where: s.feature, message: `Not converted (${s.count}): ${s.feature}` })
  for (const s of report.substitutions) issues.push({ severity: 'info', where: s.feature, message: `Substituted: ${s.feature} -> ${s.used}` })
  for (const v of report.violations ?? []) {
    issues.push({ severity: 'warn', where: v.element + (v.property ? ` { ${v.property} }` : ''), message: v.message })
  }

  // The converter returns the scene as ONE compound clip. Edit needs the scene's own clips (text, shapes,
  // their keyframes) on the timeline, so lift the nested project out: same stage, same fps, shifted to `at`.
  const nested = clip.compound?.project
  if (nested) {
    const shift = clip.startFrame
    const clips: Project['clips'] = {}
    for (const [trackId, list] of Object.entries(nested.clips)) {
      clips[trackId] = list.map((c) => (shift ? { ...c, startFrame: c.startFrame + shift } : c))
    }
    const lifted: Project = { ...nested, id: 'html-scene', fps, stage, clips, version: 5 }
    return { title, kind: 'html', project: lifted, fps, stage, issues }
  }

  const trackId = 'scene-track'
  const project: Project = {
    id: 'html-scene',
    fps,
    stage,
    version: 5,
    tracks: [{ id: trackId, name: measured.name, kind: 'video', order: 0, height: 36, locked: false, disabled: false, muted: false, solo: false }],
    clips: { [trackId]: [{ ...clip, trackId }] },
    transitions: [],
  }
  return { title, kind: 'html', project, fps, stage, issues }
}
