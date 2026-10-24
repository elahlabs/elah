import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compileVideoSpec } from '@elah/core/spec'
import { heroSpec, tileSpecs, patchProject } from './specs'

/**
 * The compiler mints random ids, and which random track holds which clip varies
 * between builds. So compare what the project says rather than its ids: stage,
 * fps, every clip with all id fields removed (sorted), and the transitions.
 * The committed JSON keeps its real ids.
 */
const isIdField = (k: string) => k === 'id' || k.endsWith('Id')
const stripIds = (v: unknown): string =>
  JSON.stringify(v, (k, val) => {
    if (isIdField(k)) return undefined
    // `clips` maps are keyed by random track ids: keep the lanes, drop the keys.
    if (k === 'clips' && val && typeof val === 'object' && !Array.isArray(val)) return Object.values(val).map(stripIds).sort()
    return val
  })

function fingerprint(project: { fps: number; stage: unknown; clips: Record<string, unknown[]>; transitions?: unknown[] }) {
  return {
    fps: project.fps,
    stage: project.stage,
    clips: Object.values(project.clips).flat().map(stripIds).sort(),
    transitions: (project.transitions ?? []).map((t) => {
      const { kind, startFrame, durationFrames } = t as { kind: string; startFrame: number; durationFrames: number }
      return { kind, startFrame, durationFrames }
    }),
  }
}

const all = { hero: heroSpec, ...tileSpecs } as Record<string, unknown>

describe('homepage demo specs', () => {
  for (const [name, spec] of Object.entries(all)) {
    it(`${name} builds with no errors and carries keyframes`, () => {
      const built = compileVideoSpec(spec as Parameters<typeof compileVideoSpec>[0])
      expect(built.issues.filter((i) => i.severity === 'error').map((i) => `${i.path}: ${i.message}`)).toEqual([])
      const clips = Object.values(built.project.clips).flat()
      expect(clips.length).toBeGreaterThan(0)
      const hasKeys = (c: (typeof clips)[number]): boolean =>
        Object.keys(c.keyframes?.channels ?? {}).length > 0 || !!c.textAnimator || !!c.effects?.length || (c.compound?.project ? Object.values(c.compound.project.clips).flat().some(hasKeys) : false)
      expect(clips.some(hasKeys)).toBe(true)
    })
  }

  it('the committed project JSON matches the specs (run node scripts/build-demos.mjs)', () => {
    for (const [name, spec] of Object.entries(all)) {
      const file = fileURLToPath(new URL(`./projects/${name}.json`, import.meta.url))
      const committed = JSON.parse(readFileSync(file, 'utf8'))
      const { project } = compileVideoSpec(spec as Parameters<typeof compileVideoSpec>[0])
      expect(fingerprint(committed), name).toEqual(fingerprint(JSON.parse(JSON.stringify(patchProject(name, project as never)))))
    }
  })
})
