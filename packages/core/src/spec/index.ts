/**
 * spec/index.ts — the public surface of the VideoSpec -> Project compiler
 * (AV-1).
 */

export type {
  SpecKind,
  SpecShape,
  SpecChannel,
  FontRole,
  SpecFormat,
  SpecDesign,
  SpecKey,
  SpecExpression,
  SpecEffect,
  SpecLayout,
  SpecPill,
  SpecReveal,
  SpecSpan,
  SpecDraw,
  SpecElement,
  SpecPaint,
  SpecSfx,
  VideoSpec,
  SpecIssue,
  CompileResult,
  CompileOptions,
} from './types'
export {
  SPEC_VERSION,
  SPEC_KINDS,
  SPEC_SHAPES,
  SPEC_CHANNELS,
  SPEC_NON_EXPRESSION_CHANNELS,
  FONT_ROLES,
  SPEC_ALIGNS,
  SPEC_EDGES,
  SPEC_ANCHOR_ALIGNS,
  SPEC_CAPS,
  SPEC_JOINS,
  SPEC_ANIMATOR_UNITS,
} from './types'

export {
  toFrames,
  toDurationFrames,
  toRadians,
  pixelBox,
  resolveToken,
  isHexColor,
  designColorMap,
  designFontMap,
  clampIssue,
  OPACITY_RANGE,
  SCALE_RANGE,
  ROTATION_DEG_RANGE,
  DURATION_SEC_RANGE,
  AT_SEC_RANGE,
} from './units'
export type { PixelBox, PixelSize, StageSize } from './units'

export { resolveCurve } from './curves'
export type { ResolvedCurve } from './curves'

export { packLayers } from './layers'
export type { LayerInput, LayerLane, LayerPackResult } from './layers'

export { compileVideoSpec } from './compile'
export type { CompileStampOptions } from './compile'

export { layProject } from './layProject'
export type { LayProjectOptions } from './layProject'

// Motion components (AV-8), the whole-piece polish pass (AV-9) and the one-call pipeline.
export { expandComponents, resolveMotionStyle, seededRandom, COMPONENT_REGISTRY, ENERGY_TIME_SCALE } from './components'
export { COMPONENT_NAMES, MOTION_ENERGIES, AMBIENT_KINDS, BEAT_TRANSITIONS, DEFAULT_MOTION_STYLE } from './components/types'
export type { ExpandOptions } from './components'
export type {
  MotionEnergy,
  AmbientKind,
  BeatTransition,
  MotionStyle,
  ComponentName,
  ComponentItem,
  SpecComponent,
  AuthoredElement,
  AuthoredSpec,
  ComponentContext,
  ComponentDef,
  ExpandResult,
} from './components/types'
export { polishSpec, lintSpec } from './polish'
export type { PolishOptions, PolishResult } from './polish'
export { buildVideo } from './build'
export type { BuildOptions, BuildResult } from './build'

// Event-bound sound cues (MI-P6): bound to an element's motion, lowered to seconds from its own keys.
export { lowerSfx, SFX_EVENTS, SFX_CUE_WORDS, SFX_CUE_SYNONYMS } from './sfxLowering'
export type { LoweredSfx } from './sfxLowering'
export type { AuthoredSfx, AuthoredEventSfx, SfxEvent } from './components/types'

// Drawn assets (MI-P5): the `vector` authored kind, lowered after compile into the imported SVG's compound of path clips.
export { lowerVectors, vectorPlaceholder, MAX_VECTOR_PARTS, VECTOR_STAGE_SIZE, VECTOR_DEFAULT_FRACTION } from './vectorLowering'
export type { VectorFields } from './vectorLowering'
export type { SpecVector } from './components/types'

// Motion systems (MI-P3): behaviours the model names, plus the authored fields lowered after compile.
export { AUTHORED_KINDS } from './components/types'
export { SYSTEM_NAMES, SYSTEM_REGISTRY, SYSTEM_DEFS, expandSystem, lowerAuthoredFields } from './systems'
export type {
  SystemName,
  SpecSystem,
  SpecMatte,
  SpecFxKey,
  AuthoredFields,
  SystemDef,
  SystemParamDef,
  SystemInput,
  SystemOutput,
} from './systems'

// Component instances (EG-P2): re-expand one component and merge, keeping hand edits.
export { expandInstance, reconcileCompound, componentFields } from './instance'
export type { InstanceContext, InstanceExpansion, ReconcileReport, ReconcileResult } from './instance'
export type { ComponentFieldSpec } from './components/types'

// Insert one component as an editable instance at a frame, with built-in sample content (EG-P5).
export { insertComponentInstance } from './insertInstance'
export type { InsertInstanceOptions, InsertInstanceResult } from './insertInstance'
export { COMPONENT_SAMPLES, componentSample } from './components/componentSamples'
export type { ComponentSampleBody } from './components/componentSamples'
