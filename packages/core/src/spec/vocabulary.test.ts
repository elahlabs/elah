import { describe, expect, it } from 'vitest'
import { specVocabulary } from './vocabulary'
import { SPEC_KINDS, SPEC_SHAPES } from './types'
import { FONT_REGISTRY, fontHasItalic } from '../fonts/registry'
import { ICON_NAMES } from '../icons'
import { MOTION_PRESETS } from '../elements/motionPresets'
import { TEXT_ANIMATOR_PRESETS } from '../elements/captions'
import { BEZIER_PRESETS } from '../elements/easingPresets'
import { SPRING_PRESETS } from '../elements/springPresets'
import { GENERATOR_REGISTRY } from '../generators/registry'
import { EFFECT_REGISTRY } from '../effects/registry'
import { COMPONENT_REGISTRY, COMPONENT_NAMES, MOTION_ENERGIES, AMBIENT_KINDS, BEAT_TRANSITIONS, type ComponentDef } from './components'
import { SYSTEM_NAMES, SYSTEM_REGISTRY, type SystemDef } from './systems'

/**
 * The point of this file: a name registered anywhere these registries live
 * MUST reach the model through `specVocabulary()`, with no separate edit —
 * the same guarantee `editorVocabulary()` gives the editing assistant. Every
 * assertion here reads a real registry rather than a hand-typed literal, so
 * adding a font/generator/effect/preset cannot silently fail to reach the
 * prompt (the ticket's own acceptance test).
 */

describe('specVocabulary', () => {
  const text = specVocabulary()
  const lines = text.split('\n')
  /** The specific line a name is declared on, not the whole blob — some short
   * names (e.g. "text") also appear incidentally elsewhere (a generator
   * param's type label, "(text)"), so a whole-text `toContain` could pass
   * even with the KINDS line itself broken. */
  const lineStartingWith = (prefix: string): string => {
    const line = lines.find((l) => l.startsWith(prefix))
    if (!line) throw new Error(`no line starts with "${prefix}"`)
    return line
  }

  it('mentions every SPEC_KIND on the KINDS line', () => {
    const line = lineStartingWith('KINDS')
    for (const kind of SPEC_KINDS) {
      expect(line, `missing kind "${kind}"`).toContain(kind)
    }
  })

  it('mentions every SPEC_SHAPE on the SHAPES line', () => {
    const line = lineStartingWith('SHAPES')
    for (const shape of SPEC_SHAPES) {
      expect(line, `missing shape "${shape}"`).toContain(shape)
    }
  })

  it('mentions every bundled font id, and says which carry a real italic', () => {
    for (const def of FONT_REGISTRY) {
      expect(text, `missing font "${def.id}"`).toContain(def.id)
    }
    expect(text).toMatch(/italic/)
    // At least one serif with a real italic is named as such — the exact
    // case the ticket calls out (playfair-display / dm-serif-display).
    const italicSerif = FONT_REGISTRY.find((d) => d.category === 'serif' && fontHasItalic(d))
    expect(italicSerif).toBeTruthy()
    expect(text).toMatch(new RegExp(`${italicSerif!.id}.*\\+italic`))
  })

  it('mentions every icon name', () => {
    for (const name of ICON_NAMES) {
      expect(text, `missing icon "${name}"`).toContain(name)
    }
  })

  it('mentions every motion preset and text reveal', () => {
    for (const p of MOTION_PRESETS) expect(text).toContain(p.name)
    for (const p of TEXT_ANIMATOR_PRESETS) expect(text).toContain(p.id)
  })

  it('mentions every bezier preset and every spring as spring:<id>', () => {
    for (const p of BEZIER_PRESETS) expect(text).toContain(p.id)
    for (const p of SPRING_PRESETS) expect(text).toContain(`spring:${p.id}`)
  })

  it('mentions every generator and effect kind, with their params', () => {
    for (const d of GENERATOR_REGISTRY.values()) {
      expect(text, `missing generator "${d.kind}"`).toContain(d.kind)
      for (const param of Object.keys(d.params)) expect(text).toContain(param)
    }
    for (const d of EFFECT_REGISTRY.values()) {
      expect(text, `missing effect "${d.kind}"`).toContain(d.kind)
    }
  })

  it('includes the expression grammar verbatim, plus the element-id note for clip()', () => {
    expect(text).toContain(
      'EXPRESSIONS (setExpression: channel = a keyframe channel, text = the expression, or null to remove it): names t (seconds from clip start)',
    )
    expect(text).toContain('wiggle(freq, amp)')
    expect(text).toMatch(/clip\("\.\.\.".*ELEMENT id/)
  })

  it('is idempotent (pure — no hidden randomness or clock)', () => {
    expect(specVocabulary()).toBe(text)
  })

  it('mentions every MOTION_ENERGIES, AMBIENT_KINDS and BEAT_TRANSITIONS name on its own MOTION line', () => {
    const energyLine = lineStartingWith('MOTION ENERGY (')
    for (const name of MOTION_ENERGIES) expect(energyLine, `missing energy "${name}"`).toContain(name)
    const ambientLine = lineStartingWith('MOTION AMBIENT (')
    for (const name of AMBIENT_KINDS) expect(ambientLine, `missing ambient "${name}"`).toContain(name)
    const transitionLine = lineStartingWith('MOTION TRANSITION (')
    for (const name of BEAT_TRANSITIONS) expect(transitionLine, `missing transition "${name}"`).toContain(name)
  })

  it('lists the real COMPONENT_REGISTRY — every built component, never a hand-written list', () => {
    // AV-8a/8b filled the registry; the block must now carry all of it.
    expect(COMPONENT_REGISTRY.size).toBe(COMPONENT_NAMES.length)
    expect(text).not.toContain('none registered yet')
    for (const name of COMPONENT_REGISTRY.keys()) expect(text, name).toContain(name)
  })
})

describe('specVocabulary — COMPONENTS block, generated from the registry it is handed', () => {
  /**
   * `COMPONENT_REGISTRY` is empty at this lane's base (AV-8a/8b fill it in
   * parallel), so the only way to prove the COMPONENTS block is GENERATED —
   * not hand-typed — is to inject a def through the exact seam
   * `specVocabulary()` reads: its `components` option, the same shape
   * `COMPONENT_REGISTRY` is. This never registers anything for real.
   */
  const fakeDef: ComponentDef = {
    name: 'kinetic-title',
    label: 'Kinetic title',
    hint: 'THE-HINT-MARKER',
    items: { min: 2, max: 5, hint: 'THE-ITEMS-HINT-MARKER' },
    variants: ['left', 'centre'],
    duration: { min: 1.5, max: 6, default: 3 },
    build: () => [],
  }
  const otherDef: ComponentDef = {
    name: 'logo-outro',
    label: 'Logo outro',
    hint: 'a second def, so the block lists more than one line',
    duration: { min: 1, max: 3, default: 2 },
    build: () => [],
  }
  const injected = new Map([
    [fakeDef.name, fakeDef],
    [otherDef.name, otherDef],
  ])
  const text = specVocabulary({ components: injected })
  const lines = text.split('\n')
  const componentLines = (() => {
    const start = lines.findIndex((l) => l.startsWith('COMPONENTS ('))
    if (start < 0) throw new Error('no COMPONENTS header')
    const out: string[] = []
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i]!
      if (!line.startsWith('- ')) break
      out.push(line)
    }
    return out
  })()

  it('lists exactly the defs the injected registry holds, one bullet each, in registry order', () => {
    expect(componentLines).toHaveLength(2)
    expect(componentLines[0]).toContain('kinetic-title')
    expect(componentLines[1]).toContain('logo-outro')
  })

  it('each bullet carries the hint, items range + hint, variants and duration range', () => {
    const line = componentLines[0]!
    expect(line).toContain('THE-HINT-MARKER')
    expect(line).toContain('2-5')
    expect(line).toContain('THE-ITEMS-HINT-MARKER')
    expect(line).toContain('left, centre')
    expect(line).toContain('1.5-6')
  })

  it('omits items/variants text for a def that declares neither', () => {
    const line = componentLines[1]!
    expect(line).not.toContain('items:')
    expect(line).not.toContain('variants:')
    expect(line).toContain('duration: 1-3s')
  })

  it('defaults to the real COMPONENT_REGISTRY when no override is given', () => {
    // No override passed: reads the actual singleton, now fully populated.
    const real = specVocabulary()
    for (const name of COMPONENT_REGISTRY.keys()) expect(real, name).toContain(name)
  })
})

describe('specVocabulary — SYSTEMS block and hold semantics (MI-P3)', () => {
  const text = specVocabulary()
  const lines = text.split('\n')
  const systemLines = (() => {
    const start = lines.findIndex((l) => l.startsWith('SYSTEMS ('))
    if (start < 0) throw new Error('no SYSTEMS header')
    const out: string[] = []
    for (let i = start + 1; i < lines.length; i++) {
      if (!lines[i]!.startsWith('- ')) break
      out.push(lines[i]!)
    }
    return out
  })()

  it('lists every registry system on its own line, in registry order, with its targets flag', () => {
    expect(SYSTEM_REGISTRY.size).toBe(SYSTEM_NAMES.length)
    expect(systemLines).toHaveLength(SYSTEM_NAMES.length)
    ;[...SYSTEM_REGISTRY.values()].forEach((def, i) => {
      expect(systemLines[i]).toContain('- ' + def.name + ' — ')
      expect(systemLines[i]).toContain('targets: ' + (def.targets ? 'yes' : 'no'))
    })
  })

  it('shows each param with its range and default, so the model can stay inside them', () => {
    const swarm = systemLines.find((l) => l.startsWith('- swarm'))!
    expect(swarm).toContain('count 3..60 =12')
    expect(swarm).toContain('bounce bool =true')
    expect(systemLines.find((l) => l.startsWith('- arrange'))).toContain('layout: grid|ring|row =grid')
    expect(systemLines.find((l) => l.startsWith('- crossMorph'))).toContain('from id, to id')
  })

  it('is generated: a def injected through the systems option appears, nothing hand-typed', () => {
    const fake: SystemDef = {
      name: 'swarm',
      hint: 'THE-SYSTEM-HINT',
      targets: true,
      template: false,
      duration: { min: 1, max: 2 },
      params: [{ name: 'widgets', kind: 'number', default: 4, min: 1, max: 9, unit: 'px' }],
      apply: () => ({ emit: [], update: [], remove: [] }),
    }
    const v = specVocabulary({ systems: new Map([['swarm', fake]]) })
    expect(v).toContain('- swarm — THE-SYSTEM-HINT. params: widgets 1..9 px =4. targets: yes. duration: 1-2s.')
    expect(v).not.toContain('- radialPush')
  })

  it('says a hold key STEPS to the next key, and how to wait and then move', () => {
    expect(text).toContain('A hold key STEPS to the next key: to wait and then move, write two plain keys with the same value.')
  })

  it('names matte and fxKeys, since the compiler schema alone cannot explain them', () => {
    expect(text).toMatch(/matte \(any element\): \{ element, kind: alpha\|luma, invert \}/)
    expect(text).toMatch(/fxKeys \(any element\): \[\{ effect, param, at, value, curve, hold \}\]/)
  })
})
