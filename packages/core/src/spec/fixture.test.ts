/**
 * fixture.test.ts — the reference-scale regression fixture (AV-6).
 *
 * `__fixtures__/clarity.spec.json` is a full-scale VideoSpec written the way
 * the vocabulary (`vocabulary.ts`) tells a model to write one: 26s, 9:16,
 * ~57 elements across every beat of the user's reference video. It exists to
 * prove the document CAN express a real piece before any model output is
 * trusted, and to give a person a file they can actually open (via SPEC_OUT,
 * see below) until the Assistant flow (AV-4) lands.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileVideoSpec } from './compile'
import { readProjectDocument } from '../editor/projectDocument'
import type { Clip, Project } from '../types'
import type { SpecElement, SpecIssue, VideoSpec } from './types'

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'clarity.spec.json')

function loadFixture(): VideoSpec {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as VideoSpec
}

function allClips(project: Project): Clip[] {
  return Object.values(project.clips).flat()
}

/** Every `SpecElement` in the document, walking into `group` children. */
function flattenElements(elements: ReadonlyArray<SpecElement>): SpecElement[] {
  const out: SpecElement[] = []
  for (const el of elements) {
    out.push(el)
    if (el.children) out.push(...flattenElements(el.children))
  }
  return out
}

/**
 * The fixture is written the way the vocabulary tells a model to write it —
 * including reveal preset ids like `word-rise` — on purpose. Until AV-7 merged,
 * the compiler rejected those ids (it checked raw animator kinds), and this file
 * carried a declared carve-out for exactly that one issue. AV-7 fixed the
 * compiler and added a drift test for the whole class, so there is no carve-out:
 * a model-shaped document of the full reference piece must compile clean.
 */

describe('clarity.spec.json — a reference-scale VideoSpec compiles clean', () => {
  const spec = loadFixture()
  const { project, issues, elementClipIds, fontIds } = compileVideoSpec(spec)

  it('is 40–60 elements (walking into groups) and 26s ± one frame', () => {
    const count = flattenElements(spec.elements).length
    expect(count).toBeGreaterThanOrEqual(40)
    expect(count).toBeLessThanOrEqual(60)
    expect(spec.duration).toBeCloseTo(26, 5)
    // ± one frame at 30fps = 1/30s.
    expect(Math.abs(spec.duration - 26)).toBeLessThanOrEqual(1 / 30)
  })

  it('has zero `error` issues', () => {
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('the reveal preset id the vocabulary offers (`word-rise`) compiled to a word-unit animator', () => {
    const clip = allClips(project).flatMap((c) => (c.type === 'compound' && c.compound?.project ? allClips(c.compound.project) : [c]))
      .find((c) => c.id === elementClipIds['because-line'])
    expect(clip?.textAnimator).toMatchObject({ unit: 'word', preset: 'rise' })
  })

  it('the `warn` issues are exactly the clamps this fixture knowingly triggers', () => {
    const warns = issues.filter((i) => i.severity === 'warn')
    // Two decimal seconds (e.g. 5.7, 22.9) rounded to the nearest frame at
    // 30fps is not itself a clamp — `toFrames`/`toDurationFrames` round, they
    // don't clamp `at`/`duration` issues. The only `warn`s this fixture is
    // expected to produce are font-weight snaps: `word-brands`/`word-market`
    // ask Inter for weight 700 (a real Inter weight, no snap) and `leverage`
    // asks for 700 too — so in practice none are expected. Assert the list
    // is empty and name any that show up, rather than swallowing them.
    for (const w of warns) {
      // eslint-disable-next-line no-console
      console.log(`unexplained warn: ${w.path} [${w.code}] ${w.message}`)
    }
    expect(warns).toEqual([])
  })

  it('fontIds is exactly the fonts the fixture uses', () => {
    expect(new Set(fontIds)).toEqual(new Set(['inter', 'playfair-display']))
  })

  it('every icon resolves to real path data — no `unknown-icon` issue anywhere', () => {
    // `elements/icon.ts` pushes an `unknown-icon` error and falls back to a
    // plain strokeless `circle` badge for any name not in `ICON_NAMES`. The
    // fixture uses only real names (user, target, rocket, banknote, zap), so
    // this list must be empty — a resolved icon compiles to `shapeKind: 'path'`.
    const iconIssues = issues.filter((i) => i.code === 'unknown-icon')
    expect(iconIssues).toEqual([])
  })

  it('every authored `text` appears in some clip content, walking into compounds', () => {
    const texts = flattenElements(spec.elements)
      .filter((e) => e.kind === 'text' && typeof e.text === 'string')
      .map((e) => e.text as string)
    function collectContent(p: Project): string[] {
      const out: string[] = []
      for (const c of allClips(p)) {
        if (typeof c.content === 'string') out.push(c.content)
        if (c.type === 'compound' && c.compound?.project) out.push(...collectContent(c.compound.project))
      }
      return out
    }
    const contents = collectContent(project)
    for (const t of texts) {
      expect(contents).toContain(t)
    }
  })

  it('has at least one compound (group), one expression channel, one spring key, one textAnimator, one shapeDraw, and one layout.anchorTo whose target exists at the same level', () => {
    function walkClips(p: Project): Clip[] {
      const out: Clip[] = []
      for (const c of allClips(p)) {
        out.push(c)
        if (c.type === 'compound' && c.compound?.project) out.push(...walkClips(c.compound.project))
      }
      return out
    }
    const clips = walkClips(project)

    expect(clips.some((c) => c.type === 'compound')).toBe(true)
    expect(clips.some((c) => Object.values(c.keyframes?.channels ?? {}).some((t) => t?.source.kind === 'expression'))).toBe(true)
    expect(clips.some((c) => Object.values(c.keyframes?.channels ?? {}).some((t) => t?.keys.some((k) => k.spring)))).toBe(true)
    expect(clips.some((c) => c.textAnimator)).toBe(true)
    expect(clips.some((c) => c.shapeDraw)).toBe(true)

    // anchorTo — the reference clip id must be a real clip id from the
    // compile, i.e. resolved by `resolveRef`, not left as the author's id.
    const anchored = clips.filter((c) => c.layout?.anchorTo?.clip)
    expect(anchored.length).toBeGreaterThan(0)
    const clipIds = new Set(Object.values(elementClipIds))
    for (const c of anchored) {
      expect(clipIds.has(c.layout!.anchorTo!.clip)).toBe(true)
    }
  })

  it('readProjectDocument round-trips the compiled project without throwing', () => {
    const roundTripped = readProjectDocument(JSON.parse(JSON.stringify(project)))
    expect(Object.keys(roundTripped.clips).length).toBeGreaterThan(0)
  })

  /**
   * `cloud-ring` carries a `gaussianBlur` effect straight out of the
   * vocabulary's EFFECTS block. Until AV-7 merged, `SpecElement.effects`
   * compiled silently to nothing — no issue, no clip field — which this file
   * recorded as a known gap. AV-7 wired it (mirroring `ops/apply.ts`
   * `addEffect`), so the blur must now reach the clip.
   */
  it('an authored effect reaches the compiled clip (`cloud-ring` gaussianBlur)', () => {
    const cloudId = elementClipIds['cloud-ring']
    expect(cloudId).toBeDefined()
    const clip = allClips(project).flatMap((c) => (c.type === 'compound' && c.compound?.project ? allClips(c.compound.project) : [c]))
      .find((c) => c.id === cloudId)
    expect(clip?.effects?.map((e) => e.kind)).toContain('gaussianBlur')
    expect(issues.filter((i) => i.path.includes('effects'))).toEqual([])
  })

  // To dump the fixture to a file:
  // `SPEC_OUT=<dir> npm run test --workspace=packages/core -- src/spec/fixture`
  // writes the compiled project as `<dir>/clarity.elah.json` — an importable
  // file (Import project from JSON in the editor) for a person to open by
  // hand, until AV-4's Assistant flow lands.
  it('writes the compiled project to SPEC_OUT when set', () => {
    if (!process.env.SPEC_OUT) return
    const dir = process.env.SPEC_OUT
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const out = join(dir, 'clarity.elah.json')
    writeFileSync(out, JSON.stringify(project, null, 2))
    expect(existsSync(out)).toBe(true)
  })
})

describe('mutation proof — an unknown icon name is caught by name', () => {
  it('renaming an icon to a non-existent name fails the zero-error assertion with `unknown-icon`', () => {
    const spec = loadFixture()
    const broken = JSON.parse(JSON.stringify(spec)) as VideoSpec
    // `u3` is the centre, highlighted icon in the "Your audience spends" row.
    const u3 = broken.elements.find((e) => e.id === 'u3')!
    u3.icon = 'not-a-real-icon-xyz'
    const { issues } = compileVideoSpec(broken)
    const iconErrors: SpecIssue[] = issues.filter((i) => i.severity === 'error' && i.code === 'unknown-icon')
    expect(iconErrors).toHaveLength(1)
    expect(iconErrors[0]!.path).toBe('elements[5].icon')
  })
})
