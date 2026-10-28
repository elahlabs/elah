/**
 * `VideoSpec` prompt vocabulary (AV-3) — the director's system prompt block.
 *
 * Generated from the live registries exactly as the editing assistant's
 * vocabulary block is: fonts,
 * icons, motion presets, reveals, curves, channels, generators, effects and
 * blend modes are all read out of the SAME registries `compile.ts` validates
 * against, so a name the model is told about and a name the compiler accepts
 * cannot drift. Adding a font, generator or effect reaches the model with no
 * edit here.
 *
 * Kept terse on purpose: this string is sent on every call and counts
 * against the context budget, so it is one line per name/registry entry
 * rather than prose.
 */

import { BLEND_MODES } from '../types'
import { FONT_REGISTRY, fontWeights, fontHasItalic, type FontDef } from '../fonts/registry'
import { ICON_NAMES } from '../icons'
import { MOTION_PRESETS } from '../elements/motionPresets'
import { TEXT_ANIMATOR_PRESETS } from '../elements/captions'
import { BEZIER_PRESETS } from '../elements/easingPresets'
import { SPRING_PRESETS } from '../elements/springPresets'
import { TEXT_ANIMATION_EASINGS } from '../resolver/textAnimation'
import { GENERATOR_REGISTRY } from '../generators/registry'
import { EFFECT_REGISTRY, type ParamDef } from '../effects/registry'
import {
  SPEC_KINDS,
  SPEC_SHAPES,
  SPEC_CHANNELS,
  SPEC_NON_EXPRESSION_CHANNELS,
  FONT_ROLES,
  SPEC_ALIGNS,
  SPEC_ANCHOR_ALIGNS,
  SPEC_EDGES,
  SPEC_CAPS,
  SPEC_JOINS,
  SPEC_ANIMATOR_UNITS,
} from './types'
import {
  COMPONENT_REGISTRY,
  MOTION_ENERGIES,
  AMBIENT_KINDS,
  BEAT_TRANSITIONS,
  type ComponentDef,
  type ComponentName,
} from './components'
import { SYSTEM_REGISTRY, type SystemDef, type SystemName, type SystemParamDef } from './systems'
import { SFX_CUE_SYNONYMS, SFX_CUE_WORDS, SFX_EVENTS } from './sfxLowering'

/** `key range` for a number param, `key: a|b|c` for an enum, `key (type)` otherwise. */
function formatParams(params: Record<string, ParamDef>): string {
  return Object.entries(params)
    .map(([k, p]) =>
      p.type === 'number'
        ? `${k} ${p.min}..${p.max}`
        : p.type === 'enum'
          ? `${k}: ${(p.options ?? []).join('|')}`
          : `${k} (${p.type})`,
    )
    .join(', ')
}

function fontLine(def: FontDef): string {
  const weights = fontWeights(def).join(',')
  const italic = fontHasItalic(def) ? ' +italic' : ''
  return `- ${def.id} (${def.category}) weights ${weights}${italic}`
}

/** `- name — hint. items: min-max (hint). variants: a, b. duration: min-maxs.` */
function componentLine(def: ComponentDef): string {
  const items = def.items ? ` items: ${def.items.min}-${def.items.max} (${def.items.hint}).` : ''
  const variants = def.variants?.length ? ` variants: ${def.variants.join(', ')}.` : ''
  return `- ${def.name} — ${def.hint}.${items}${variants} duration: ${def.duration.min}-${def.duration.max}s.`
}

/**
 * The COMPONENTS block, generated from a components registry — `COMPONENT_REGISTRY`
 * by default. Takes the registry as a parameter (rather than reading the
 * import directly) so a test can inject a def "through the same map the code
 * reads" without registering one for real: AV-8a/8b fill `COMPONENT_REGISTRY`
 * in parallel and it is empty at this lane's base, so this function's own
 * correctness cannot depend on the registry already having entries.
 */
function componentsBlock(registry: ReadonlyMap<ComponentName, ComponentDef>): string {
  const defs = [...registry.values()]
  if (!defs.length) return '(none registered yet — use raw elements for every beat)'
  return defs.map(componentLine).join('\n')
}

/** `name 3..60 px =12` for a number, `name: a|b =a` for an enum, `name bool =true`, `name id` for an element id. */
function systemParamLabel(p: SystemParamDef): string {
  const dflt = p.default === undefined ? '' : ` =${String(p.default)}`
  if (p.kind === 'number') return `${p.name} ${p.min ?? ''}..${p.max ?? ''}${p.unit ? ` ${p.unit}` : ''}${dflt}`
  if (p.kind === 'enum') return `${p.name}: ${(p.options ?? []).join('|')}${dflt}`
  if (p.kind === 'boolean') return `${p.name} bool${dflt}`
  return `${p.name} id`
}

/** `- name — hint. params: a 3..60, b: x|y. targets: yes.` One line per registry entry, so a new system reaches the model with no edit here. */
function systemLine(def: SystemDef): string {
  const params = def.params.length ? ` params: ${def.params.map(systemParamLabel).join(', ')}.` : ''
  return `- ${def.name} — ${def.hint}.${params} targets: ${def.targets ? 'yes' : 'no'}. duration: ${def.duration.min}-${def.duration.max}s.`
}

/** The SYSTEMS block, generated from a systems registry — `SYSTEM_REGISTRY` by default (a parameter, like `componentsBlock`'s, so a test can inject one). */
function systemsBlock(registry: ReadonlyMap<SystemName, SystemDef>): string {
  return [...registry.values()].map(systemLine).join('\n')
}

function motionStyleBlock(): string {
  return [
    `MOTION ENERGY (motion.energy, or a component's own energy override): ${MOTION_ENERGIES.join(', ')}`,
    `MOTION AMBIENT (motion.ambient, a background layer that never stops moving): ${AMBIENT_KINDS.join(', ')}`,
    `MOTION TRANSITION (motion.transition, how one beat hands off to the next): ${BEAT_TRANSITIONS.join(', ')}`,
  ].join('\n')
}

/**
 * The EXPRESSIONS line, copied VERBATIM from `editorAgent.ts:95` (do not
 * paraphrase it — see the ticket). The trailing sentence below it is new: in
 * `VideoSpec`, `clip("...")` addresses an ELEMENT id, not a compiled clip id.
 */
const EXPRESSION_GRAMMAR =
  'EXPRESSIONS (setExpression: channel = a keyframe channel, text = the expression, or null to remove it): names t (seconds from clip start), frame, fps, duration (s), progress (0..1), value (the keyed or set value), PI, stage.width, stage.height, clip("id or name").x|y|scale|scaleX|scaleY|rotation|opacity|start|duration; functions sin cos abs floor ceil round sqrt pow min max clamp lerp smoothstep exp log wiggle(freq, amp) spring(seconds) ease(x, "curve") loop(x, period) pingpong(x, length) pulse(x, period, duty); operators + - * / % ^ < <= > >= == != && || ! ?:'

export interface SpecVocabularyOptions {
  /**
   * Override for `COMPONENT_REGISTRY`, the same shape the real registry is.
   * Only a test passes this — see `componentsBlock`'s doc comment.
   */
  components?: ReadonlyMap<ComponentName, ComponentDef>
  /** Override for `SYSTEM_REGISTRY`; only a test passes this. */
  systems?: ReadonlyMap<SystemName, SystemDef>
}

/** The vocabulary block of the video director's system prompt, from the registries. */
export function specVocabulary(opts: SpecVocabularyOptions = {}): string {
  const fonts = FONT_REGISTRY.map(fontLine).join('\n')

  const generators = [...GENERATOR_REGISTRY.values()]
    .map((d) => {
      const presets = d.presets?.length ? ` presets: ${d.presets.map((p) => p.id).join(', ')}` : ''
      return `- ${d.kind} (${d.label}${d.placed ? ', placed by region' : ', full frame'}) — ${d.hint}. params: ${formatParams(d.params)}.${presets}`
    })
    .join('\n')

  const effects = [...EFFECT_REGISTRY.values()]
    .map((d) => {
      const presets = d.presets?.length ? ` presets: ${d.presets.map((p) => p.id).join(', ')}` : ''
      return `- ${d.kind} (${d.label}; ${d.category}) params: ${formatParams(d.params)}.${presets}`
    })
    .join('\n')

  const curves = [
    ...BEZIER_PRESETS.map((p) => p.id),
    ...SPRING_PRESETS.map((p) => `spring:${p.id}`),
    ...TEXT_ANIMATION_EASINGS,
  ].join(', ')

  return [
    `KINDS (element.kind): ${SPEC_KINDS.join(', ')}`,
    `SHAPES (shape, polygon/arc/ellipse are compiler conveniences): ${SPEC_SHAPES.join(', ')}`,
    '',
    'FONTS (font, or a "$role" from design.fonts[].role):',
    fonts,
    `FONT ROLES (design.fonts[].role): ${FONT_ROLES.join(', ')}. A raw font id is also accepted wherever a role is.`,
    '',
    `ICONS (icon — only from this list, never invent a name): ${ICON_NAMES.join(', ')}`,
    '',
    'COMPONENTS (element.kind "component", element.component — a named, parametrised piece of motion design; expands to a group of choreographed raw elements. Never invent a name outside this list.):',
    componentsBlock(opts.components ?? COMPONENT_REGISTRY),
    '',
    'SYSTEMS (element.kind "system", element.system — a behaviour named in the spec and expanded to raw elements and keys; targets = ids of SIBLING elements at the same level, or of an earlier system; params = {name, value} rows; x,y,w,h place its region, centre or origin; swarm takes template, one raw element. Never invent a name outside this list.):',
    systemsBlock(opts.systems ?? SYSTEM_REGISTRY),
    'matte (any element): { element, kind: alpha|luma, invert } cuts this element by a SIBLING element\'s alpha or luminance; that element is hidden. fxKeys (any element): [{ effect, param, at, value, curve, hold }] keys a parameter of an effect already in this element\'s effects; at = seconds from this element\'s start.',
    'vector (element.kind "vector", element.asset — a drawn SVG placed as a compound of editable parts named by the SVG ids; asset is ONLY a name listed in the ASSETS block of the scene, never invented. Any raw-element field applies; w,h set the fit box: the long edge of the drawing = max(w, h) px, default 30% of the short side of the stage.)',
    '',
    motionStyleBlock(),
    '',
    `MOTION PRESETS (enter/exit): ${MOTION_PRESETS.map((p) => p.name).join(', ')}`,
    `TEXT REVEALS (reveal.preset): ${TEXT_ANIMATOR_PRESETS.map((p) => p.id).join(', ')}`,
    `CURVES (keys[].curve, draw.curve): ${curves}`,
    `CHANNELS (keys[].channel, expressions[].channel): ${SPEC_CHANNELS.join(', ')}. ${SPEC_NON_EXPRESSION_CHANNELS.join(', ')} may only be keyed, never given an expression.`,
    'A hold key STEPS to the next key: to wait and then move, write two plain keys with the same value.',
    `SFX (sfx[]): { cue, gain } plus EITHER at (seconds) OR on: { element, event: ${SFX_EVENTS.join('|')}, channel, index, offset }. Prefer on — it follows the element when the scene is retimed. element = the id of an element you wrote (or a system's "<id>-N" copy); arrive = when its first opacity/scale/x/y key (or its enter preset) starts; exit = its last such key (or exit preset); key = the index-th key (0-based) on channel; offset = seconds added after, -0.5..0.5. Cue words with a fixed sound: ${SFX_CUE_WORDS.join(', ')} (${Object.entries(SFX_CUE_SYNONYMS).map(([a, b]) => `${a} = ${b}`).join(', ')}); any other word is searched. Sound only real hits.`,
    '',
    'GENERATORS (generator kind / preset / params):',
    generators,
    '',
    'EFFECTS (effects[].kind / preset / params):',
    effects,
    `BLEND MODES (blend): ${BLEND_MODES.join(', ')}`,
    '',
    `ALIGN (align): ${SPEC_ALIGNS.join(', ')}`,
    `ANCHOR ALIGN (layout.anchorTo.align): ${SPEC_ANCHOR_ALIGNS.join(', ')}`,
    `EDGES (layout.anchorTo.edge): ${SPEC_EDGES.join(', ')}`,
    `CAPS (cap): ${SPEC_CAPS.join(', ')}`,
    `JOINS (join): ${SPEC_JOINS.join(', ')}`,
    `ANIMATOR UNITS (reveal.unit): ${SPEC_ANIMATOR_UNITS.join(', ')}`,
    '',
    EXPRESSION_GRAMMAR,
    'In VideoSpec, clip("...") takes an ELEMENT id — the author\'s own "id" field on another element, not a compiled clip id; the compiler rewrites it.',
    'UNITS: element fields and keys[] are in author units (rotation in DEGREES, positions 0..1 of the stage, sizes in px) and are converted for you. EXPRESSIONS are NOT converted: they run in engine units — rotation in RADIANS (write `value + t * PI` for half a turn per second, never `t * 180`), x/y as 0..1 of the stage, cornerRadius as 0..0.5 of the shorter stage side.',
  ].join('\n')
}
