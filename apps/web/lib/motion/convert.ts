/**
 * Convert an HTML + CSS scene (or a VideoSpec) into an engine `Project`, and say
 * what happened. The HTML path needs the browser measuring step in `./measure`;
 * it is built in this page, the package does not ship it (brief 6.3).
 *
 * The report keeps every refusal verbatim: the subset refuses loudly, which is
 * a feature.
 */

import { ensureFonts, FONT_REGISTRY, type Project } from '@elah/core'
import { buildVideo, type AuthoredSpec, type SpecIssue } from '@elah/core/spec'
import { sceneToClip, validateScene, type SceneSource } from '@elah/core/html'
import { measureScene } from './measure'

export const FONT_BASE_URL = '/fonts/'

export interface ReportItem {
  severity: 'native' | 'refused' | 'warn'
  where: string
  message: string
}

export interface Converted {
  project: Project
  fps: number
  stage: { width: number; height: number }
  report: ReportItem[]
}

export class ConvertError extends Error {
  constructor(message: string, readonly report: ReportItem[] = []) {
    super(message)
  }
}

let fontsOnce: Promise<void> | undefined
export function loadAllFonts(): Promise<void> {
  fontsOnce ??= ensureFonts(
    FONT_REGISTRY.map((f) => f.id),
    { baseUrl: FONT_BASE_URL, fonts: document.fonts, onWarning: (m) => console.warn(m) },
  )
    .then(() => document.fonts.ready)
    .then(() => undefined)
  return fontsOnce
}

export interface HtmlInput {
  html: string
  css: string
  durationSeconds: number
  stage: { width: number; height: number }
  fps: number
}

export async function convertHtml(input: HtmlInput): Promise<Converted> {
  const scene: SceneSource = { html: input.html, css: input.css }
  const verdict = validateScene(scene)
  const refused: ReportItem[] = verdict.violations.map((v) => ({
    severity: 'refused',
    where: v.element + (v.property ? ` { ${v.property}${v.value ? `: ${v.value}` : ''} }` : ''),
    message: v.message + (v.substitute ? ` Use instead: ${v.substitute}` : ''),
  }))
  if (!verdict.ok) throw new ConvertError('The scene was refused by the converter.', refused)

  await loadAllFonts()
  const measured = await measureScene(scene, { stage: input.stage, fontsReady: loadAllFonts })
  if (input.durationSeconds > 0) measured.duration = input.durationSeconds
  const { clip, report } = sceneToClip(measured, { fps: input.fps })

  const items: ReportItem[] = [...refused]
  for (const s of report.skipped) items.push({ severity: 'warn', where: s.feature, message: `Not converted (${s.count}): ${s.feature}` })
  for (const s of report.substitutions) items.push({ severity: 'native', where: s.feature, message: `Substituted: ${s.feature} -> ${s.used}` })
  for (const v of report.violations ?? []) {
    items.push({ severity: 'warn', where: v.element + (v.property ? ` { ${v.property} }` : ''), message: v.message })
  }

  // The converter returns the scene as ONE compound clip. Lift its nested clips
  // onto the timeline so the keys are visible and editable as numbers.
  const { stage, fps } = input
  const nested = clip.compound?.project
  if (nested) {
    const shift = clip.startFrame
    const clips: Project['clips'] = {}
    for (const [trackId, list] of Object.entries(nested.clips)) {
      clips[trackId] = list.map((c) => (shift ? { ...c, startFrame: c.startFrame + shift } : c))
    }
    const project: Project = { ...nested, id: 'html-scene', fps, stage, clips, version: 5 }
    items.unshift({ severity: 'native', where: 'scene', message: `Converted to ${Object.values(clips).reduce((n, l) => n + l.length, 0)} native clips with keyframes.` })
    return { project, fps, stage, report: items }
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
  return { project, fps, stage, report: items }
}

export function convertSpec(spec: unknown): Converted {
  if (!spec || typeof spec !== 'object') throw new ConvertError('A VideoSpec must be a JSON object.')
  const built = buildVideo(spec as AuthoredSpec)
  const issue = (i: SpecIssue): ReportItem => ({
    severity: i.severity === 'error' ? 'refused' : 'warn',
    where: i.path,
    message: `${i.code}: ${i.message}`,
  })
  const report = built.issues.map(issue)
  const hasClips = Object.values(built.project.clips).some((l) => l.length > 0)
  if (!hasClips) throw new ConvertError('The spec compiled to an empty video.', report)
  report.unshift({ severity: 'native', where: 'spec', message: 'Compiled to native clips and keyframes.' })
  return { project: built.project, fps: built.project.fps, stage: built.project.stage, report }
}
