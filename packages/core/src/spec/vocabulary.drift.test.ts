import { describe, expect, it } from 'vitest'
import { compileVideoSpec } from './compile'
import { specVocabulary } from './vocabulary'
import type { SpecElement, VideoSpec, SpecIssue } from './types'
import { COMPONENT_NAMES, COMPONENT_REGISTRY, expandComponents, resolveMotionStyle, type AuthoredSpec, type ComponentDef } from './components'

/**
 * The drift test (AV-7).
 *
 * `vocabulary.ts` and `compile.ts` are two independent files that must agree
 * on every name a spec may use. `specVocabulary()` is `vocabulary.ts`'s own
 * OUTPUT — the literal text an AI model reads — so every name list below is
 * parsed back out of that text rather than imported from the registries a
 * second time. Hand-copying the registries here would let this file drift
 * the exact same way `elements/text.ts` drifted from `vocabulary.ts:103`: a
 * test that reads the same source twice can still agree with itself while
 * disagreeing with the model. Parsing the model's own prompt text is the
 * only source that cannot lie about what the model was actually told.
 *
 * Each `it()` below builds a spec that uses EVERY name one vocabulary line
 * offers, in the field that line documents, and asserts `compileVideoSpec`
 * reports zero `error`-severity issues for it (per `SpecIssue`'s own doc
 * comment, `error` means "a named thing does not exist" — exactly a name the
 * compiler didn't recognise). A category is isolated in its own spec so a
 * failure names the exact vocabulary line that drifted, not just "something,
 * somewhere".
 *
 * Mutation proof (recorded in the ticket's Result): reverting the
 * `elements/text.ts` reveal-preset fix makes "text reveals (reveal.preset)"
 * fail, naming `word-rise` in its issue list.
 */

function baseSpec(elements: SpecElement[]): VideoSpec {
  return { format: { width: 1080, height: 1920, fps: 30 }, duration: 600, elements }
}

/** Every `error`-severity issue, formatted for a failure message that names the offender. */
function errorSummary(spec: VideoSpec): string[] {
  return compileVideoSpec(spec)
    .issues.filter((i) => i.severity === 'error')
    .map((i) => `${i.code} @ ${i.path}: ${i.message}`)
}

function expectNoDrift(spec: VideoSpec): void {
  expect(errorSummary(spec), 'compileVideoSpec reported unknown-* issues for names vocabulary.ts offers').toEqual([])
}

// ---------------------------------------------------------------------------
// Parsing `specVocabulary()`'s own output
// ---------------------------------------------------------------------------

const VOCAB = specVocabulary()
const LINES = VOCAB.split('\n')

function lineStartingWith(prefix: string): string {
  const line = LINES.find((l) => l.startsWith(prefix))
  if (!line) throw new Error(`no vocabulary line starts with "${prefix}"`)
  return line
}

/** The comma-separated list after a line's first "`: `" (every single-line vocabulary entry uses this shape), stopping at an optional trailing ". " sentence. */
function namesOnLine(prefix: string): string[] {
  const line = lineStartingWith(prefix)
  const idx = line.indexOf(': ')
  if (idx < 0) throw new Error(`vocabulary line "${prefix}" has no "': '"`)
  const rest = line.slice(idx + 2)
  const csv = rest.split('. ')[0]!
  return csv.split(', ').map((s) => s.trim())
}

/** `- <name> (...` bullet lines directly following a header line, up to the first non-bullet line. */
function bulletBlock(headerPrefix: string, lines: string[] = LINES): string[] {
  const start = lines.findIndex((l) => l.startsWith(headerPrefix))
  if (start < 0) throw new Error(`no vocabulary header starts with "${headerPrefix}"`)
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.startsWith('- ')) break
    out.push(line)
  }
  return out
}

/** The bulleted name: `- name (...` -> `name`. */
function bulletName(line: string): string {
  const m = line.match(/^- (\S+)/)
  if (!m) throw new Error(`bullet line has no leading name: "${line}"`)
  return m[1]!
}

/** The `presets: a, b, c` suffix of a generator/effect bullet line, if any. */
function bulletPresets(line: string): string[] {
  const marker = ' presets: '
  const idx = line.indexOf(marker)
  if (idx < 0) return []
  return line
    .slice(idx + marker.length)
    .split(', ')
    .map((s) => s.trim())
}

// ---------------------------------------------------------------------------
// Fonts (font, and design.fonts[].role)
// ---------------------------------------------------------------------------

describe('drift: fonts (FONT_REGISTRY ids, and each role) -> font', () => {
  it('every bundled font id compiles with zero unknown-font/-token issues', () => {
    const fontIds = bulletBlock('FONTS (').map(bulletName)
    expect(fontIds.length).toBeGreaterThan(0)
    const elements: SpecElement[] = fontIds.map((id, i) => ({
      id: `f${i}`,
      kind: 'text',
      text: 'Hi',
      at: 0,
      duration: 1,
      layer: i,
      font: id,
    }))
    expectNoDrift(baseSpec(elements))
  })

  it('every FONT ROLE resolves through design.fonts[].role with zero unknown-token issues', () => {
    const fontIds = bulletBlock('FONTS (').map(bulletName)
    const roles = namesOnLine('FONT ROLES (')
    expect(roles.length).toBeGreaterThan(0)
    const elements: SpecElement[] = roles.map((role, i) => ({
      id: `r${i}`,
      kind: 'text',
      text: 'Hi',
      at: 0,
      duration: 1,
      layer: i,
      font: `$${role}`,
    }))
    const spec: VideoSpec = { ...baseSpec(elements), design: { fonts: roles.map((role) => ({ role, font: fontIds[0]! })) } }
    expectNoDrift(spec)
  })
})

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

describe('drift: icons (ICON_NAMES) -> icon', () => {
  it('every icon name compiles with zero unknown-icon issues', () => {
    const icons = namesOnLine('ICONS (')
    expect(icons.length).toBeGreaterThan(0)
    const elements: SpecElement[] = icons.map((name, i) => ({ id: `i${i}`, kind: 'icon', icon: name, at: 0, duration: 1, layer: i }))
    expectNoDrift(baseSpec(elements))
  })
})

// ---------------------------------------------------------------------------
// Motion presets
// ---------------------------------------------------------------------------

describe('drift: motion presets (MOTION_PRESETS) -> enter, exit', () => {
  it('every motion preset name compiles as both enter and exit with zero unknown-preset issues', () => {
    const presets = namesOnLine('MOTION PRESETS (')
    expect(presets.length).toBeGreaterThan(0)
    const elements: SpecElement[] = presets.flatMap((name, i) => [
      { id: `en${i}`, kind: 'shape' as const, shape: 'rect' as const, at: 0, duration: 1, layer: i * 2, enter: name },
      { id: `ex${i}`, kind: 'shape' as const, shape: 'rect' as const, at: 0, duration: 1, layer: i * 2 + 1, exit: name },
    ])
    expectNoDrift(baseSpec(elements))
  })
})

// ---------------------------------------------------------------------------
// Text reveals — the drift the ticket was opened for
// ---------------------------------------------------------------------------

describe('drift: text reveals (TEXT_ANIMATOR_PRESETS ids) -> reveal.preset', () => {
  it('every reveal preset id compiles with zero unknown-preset issues (mutation-proofs the word-rise fix)', () => {
    const reveals = namesOnLine('TEXT REVEALS (')
    expect(reveals.length).toBeGreaterThan(0)
    expect(reveals).toContain('word-rise')
    const elements: SpecElement[] = reveals.map((preset, i) => ({
      id: `t${i}`,
      kind: 'text',
      text: 'Hello there',
      at: 0,
      duration: 2,
      layer: i,
      reveal: { preset },
    }))
    expectNoDrift(baseSpec(elements))
  })
})

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

describe('drift: curves (bezier ids, spring:<id>, named easings) -> keys[].curve, draw.curve', () => {
  it('every curve name compiles on keys[].curve with zero unknown-curve issues', () => {
    const curves = namesOnLine('CURVES (')
    expect(curves.length).toBeGreaterThan(0)
    const duration = curves.length + 1
    const spec = baseSpec([
      {
        id: 's',
        kind: 'shape',
        shape: 'rect',
        at: 0,
        duration,
        keys: curves.map((curve, i) => ({ channel: 'opacity', at: i, value: i % 2, curve })),
      },
    ])
    expectNoDrift(spec)
  })

  it('every curve name compiles on draw.curve with zero unknown-curve issues', () => {
    const curves = namesOnLine('CURVES (')
    const elements: SpecElement[] = curves.map((curve, i) => ({
      id: `d${i}`,
      kind: 'shape',
      shape: 'arc',
      at: 0,
      duration: 1,
      layer: i,
      draw: { from: 0, to: 1, curve },
    }))
    expectNoDrift(baseSpec(elements))
  })
})

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

describe('drift: channels (SPEC_CHANNELS) -> keys[].channel', () => {
  it('every channel compiles with zero unknown-channel issues', () => {
    const channels = namesOnLine('CHANNELS (')
    expect(channels.length).toBeGreaterThan(0)
    const spec = baseSpec([
      {
        id: 's',
        kind: 'shape',
        shape: 'rect',
        at: 0,
        duration: 2,
        keys: channels.map((channel, i) => ({ channel, at: 0, value: i })),
      },
    ])
    expectNoDrift(spec)
  })
})

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

describe('drift: generators (GENERATOR_REGISTRY kinds, each preset) -> generator, preset', () => {
  it('every generator kind compiles with zero unknown-generator issues', () => {
    const kinds = bulletBlock('GENERATORS (').map(bulletName)
    expect(kinds.length).toBeGreaterThan(0)
    const elements: SpecElement[] = kinds.map((kind, i) => ({ id: `g${i}`, kind: 'generator', generator: kind, at: 0, duration: 1, layer: i }))
    expectNoDrift(baseSpec(elements))
  })

  it('every generator preset compiles (against its own kind) with zero unknown-preset issues', () => {
    const bullets = bulletBlock('GENERATORS (')
    const pairs = bullets.flatMap((line) => bulletPresets(line).map((preset) => ({ kind: bulletName(line), preset })))
    expect(pairs.length).toBeGreaterThan(0)
    const elements: SpecElement[] = pairs.map((pair, i) => ({
      id: `gp${i}`,
      kind: 'generator',
      generator: pair.kind,
      preset: pair.preset,
      at: 0,
      duration: 1,
      layer: i,
    }))
    expectNoDrift(baseSpec(elements))
  })
})

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

describe('drift: effects (EFFECT_REGISTRY kinds, each preset) -> effects[]', () => {
  it('every effect kind compiles with zero unknown-effect issues', () => {
    const kinds = bulletBlock('EFFECTS (').map(bulletName)
    expect(kinds.length).toBeGreaterThan(0)
    const spec = baseSpec([{ id: 's', kind: 'shape', shape: 'rect', at: 0, duration: 1, effects: kinds.map((kind) => ({ kind })) }])
    expectNoDrift(spec)
  })

  it('every effect preset compiles (against its own kind) with zero unknown-preset issues', () => {
    const bullets = bulletBlock('EFFECTS (')
    const pairs = bullets.flatMap((line) => bulletPresets(line).map((preset) => ({ kind: bulletName(line), preset })))
    expect(pairs.length).toBeGreaterThan(0)
    const spec = baseSpec([{ id: 's', kind: 'shape', shape: 'rect', at: 0, duration: 1, effects: pairs.map((p) => ({ kind: p.kind, preset: p.preset })) }])
    expectNoDrift(spec)
  })
})

// ---------------------------------------------------------------------------
// Blend modes
// ---------------------------------------------------------------------------

describe('drift: blend modes (BLEND_MODES) -> blend', () => {
  it('every blend mode compiles with zero unknown-blend issues', () => {
    const modes = namesOnLine('BLEND MODES (')
    expect(modes.length).toBeGreaterThan(0)
    const elements: SpecElement[] = modes.map((mode, i) => ({ id: `b${i}`, kind: 'shape', shape: 'rect', at: 0, duration: 1, layer: i, blend: mode }))
    expectNoDrift(baseSpec(elements))
  })
})

// ---------------------------------------------------------------------------
// Components (AV-10) — the COMPONENTS block vs COMPONENT_REGISTRY/COMPONENT_NAMES
// ---------------------------------------------------------------------------

/**
 * `expandComponents` (not `compileVideoSpec`) is the relevant compiler here:
 * `component` elements never reach `compile.ts` — they are lowered to plain
 * groups first. `unknown-component` and `component-unavailable` are the two
 * codes it can report for a bad `component` name (see `components/index.ts`);
 * this file must prove the vocabulary never produces the first one, and that
 * the second is produced ONLY for a name the registry genuinely lacks yet.
 */
function authoredSpecFor(componentName: string): AuthoredSpec {
  return {
    format: { width: 1080, height: 1920, fps: 30 },
    duration: 5,
    elements: [{ id: 'c', kind: 'component', component: componentName, at: 0, duration: 2 }],
  }
}

function codesFor(componentName: string): string[] {
  return expandComponents(authoredSpecFor(componentName)).issues.map((i) => i.code)
}

describe('drift: components (COMPONENT_REGISTRY) -> the COMPONENTS block', () => {
  it('the COMPONENTS block lists exactly COMPONENT_REGISTRY\'s keys, proven by injecting a def through specVocabulary()\'s own "components" option — the same map the code reads', () => {
    const fakeDef: ComponentDef = {
      name: 'kinetic-title',
      label: 'Kinetic title',
      hint: 'a def injected only for this test, never registered for real',
      duration: { min: 1, max: 5, default: 2 },
      build: () => [],
    }
    const injected = new Map(COMPONENT_REGISTRY)
    injected.set(fakeDef.name, fakeDef)
    const injectedText = specVocabulary({ components: injected })
    const names = bulletBlock('COMPONENTS (', injectedText.split('\n')).map(bulletName)
    expect(names.sort()).toEqual([...injected.keys()].sort())
  })

  it('every name the REAL COMPONENTS block currently offers expands with zero unknown-component and zero component-unavailable issues (vacuous while the registry is empty)', () => {
    const registryNames = [...COMPONENT_REGISTRY.keys()]
    const vocabNames = bulletBlock('COMPONENTS (').map(bulletName)
    // The two sets agree: what the block offers IS what the registry holds.
    expect(vocabNames.sort()).toEqual(registryNames.sort())
    for (const name of vocabNames) {
      const codes = codesFor(name)
      expect(codes, name).not.toContain('unknown-component')
      expect(codes, name).not.toContain('component-unavailable')
    }
  })

  it('every COMPONENT_NAME is built: the registry and the name list agree exactly', () => {
    // AV-10 wrote this against an empty registry, asserting the unbuilt
    // names degraded cleanly. AV-8a/8b built all 17, so the stronger claim
    // holds: nothing the vocabulary offers is unavailable, and every
    // registered def is a declared name.
    const registryNames = new Set(COMPONENT_REGISTRY.keys())
    const unbuilt = COMPONENT_NAMES.filter((n) => !registryNames.has(n))
    expect(unbuilt).toEqual([])
    expect([...registryNames].sort()).toEqual([...COMPONENT_NAMES].sort())
    for (const name of COMPONENT_NAMES) {
      const codes = codesFor(name)
      expect(codes, name).not.toContain('component-unavailable')
      expect(codes, name).not.toContain('unknown-component')
    }
  })

  it('a name outside COMPONENT_NAMES entirely reports unknown-component, never component-unavailable', () => {
    const codes = codesFor('not-a-real-component')
    expect(codes).toContain('unknown-component')
    expect(codes).not.toContain('component-unavailable')
  })
})

// ---------------------------------------------------------------------------
// Motion style (AV-10) — MOTION ENERGY/AMBIENT/TRANSITION lines vs resolveMotionStyle
// ---------------------------------------------------------------------------

describe('drift: motion style (MOTION_ENERGIES, AMBIENT_KINDS, BEAT_TRANSITIONS) -> motion.energy/ambient/transition', () => {
  it('every MOTION ENERGY name resolves with zero unknown-style issues', () => {
    const names = namesOnLine('MOTION ENERGY (')
    expect(names.length).toBeGreaterThan(0)
    for (const energy of names) {
      const issues: SpecIssue[] = []
      resolveMotionStyle({ energy: energy as never }, issues)
      expect(issues.filter((i) => i.code === 'unknown-style'), energy).toEqual([])
    }
  })

  it('every MOTION AMBIENT name resolves with zero unknown-style issues', () => {
    const names = namesOnLine('MOTION AMBIENT (')
    expect(names.length).toBeGreaterThan(0)
    for (const ambient of names) {
      const issues: SpecIssue[] = []
      resolveMotionStyle({ ambient: ambient as never }, issues)
      expect(issues.filter((i) => i.code === 'unknown-style'), ambient).toEqual([])
    }
  })

  it('every MOTION TRANSITION name resolves with zero unknown-style issues', () => {
    const names = namesOnLine('MOTION TRANSITION (')
    expect(names.length).toBeGreaterThan(0)
    for (const transition of names) {
      const issues: SpecIssue[] = []
      resolveMotionStyle({ transition: transition as never }, issues)
      expect(issues.filter((i) => i.code === 'unknown-style'), transition).toEqual([])
    }
  })

  it('a name outside any of the three lists reports unknown-style', () => {
    const issues: SpecIssue[] = []
    resolveMotionStyle({ energy: 'not-a-real-energy' as never }, issues)
    expect(issues.map((i) => i.code)).toContain('unknown-style')
  })
})
