/**
 * Deterministic debug render scenarios for GPU renderer validation.
 *
 * Each scenario returns a fixed set of DebugRenderItem quads designed to
 * exercise a specific aspect of the render pipeline visually.
 */

import { DEBUG_STAGE, type DebugRenderItem, type DebugScenario } from './types'

const { width: SW, height: SH } = DEBUG_STAGE

/** Scenario A — single centred red quad. Validates basic mount + draw. */
export function scenarioA(): DebugRenderItem[] {
  return [
    {
      id: 'a-center',
      zIndex: 0,
      color: [0.9, 0.15, 0.15, 1],
      x: (SW - 400) / 2,
      y: (SH - 300) / 2,
      width: 400,
      height: 300,
    },
  ]
}

/** Scenario B — four overlapping quads with distinct zIndex values. */
export function scenarioB(): DebugRenderItem[] {
  return [
    {
      id: 'b-back',
      zIndex: 0,
      color: [0.2, 0.4, 0.9, 1],
      x: 200,
      y: 150,
      width: 500,
      height: 400,
    },
    {
      id: 'b-mid-low',
      zIndex: 1,
      color: [0.2, 0.75, 0.3, 1],
      x: 350,
      y: 200,
      width: 500,
      height: 400,
    },
    {
      id: 'b-mid-high',
      zIndex: 2,
      color: [0.9, 0.7, 0.1, 1],
      x: 500,
      y: 250,
      width: 500,
      height: 400,
    },
    {
      id: 'b-front',
      zIndex: 3,
      color: [0.85, 0.2, 0.2, 1],
      x: 650,
      y: 300,
      width: 500,
      height: 400,
    },
  ]
}

/** Scenario C — transformed quads: translation, scale, rotation. */
export function scenarioC(): DebugRenderItem[] {
  return [
    {
      id: 'c-translate',
      zIndex: 0,
      color: [0.2, 0.4, 0.9, 1],
      x: 80,
      y: 80,
      width: 200,
      height: 150,
    },
    {
      id: 'c-scale',
      zIndex: 1,
      color: [0.2, 0.75, 0.3, 1],
      x: SW / 2 - 150,
      y: SH / 2 - 100,
      width: 300,
      height: 200,
      rotation: 0,
    },
    {
      id: 'c-rotate',
      zIndex: 2,
      color: [0.85, 0.2, 0.85, 1],
      x: SW - 380,
      y: SH / 2 - 120,
      width: 260,
      height: 240,
      rotation: Math.PI / 6,
    },
  ]
}

/** Scenario D — opacity blending with three overlapping quads. */
export function scenarioD(): DebugRenderItem[] {
  return [
    {
      id: 'd-opaque',
      zIndex: 0,
      color: [0.9, 0.15, 0.15, 1],
      x: 300,
      y: 180,
      width: 400,
      height: 360,
      opacity: 1.0,
    },
    {
      id: 'd-half',
      zIndex: 1,
      color: [0.15, 0.75, 0.25, 1],
      x: 440,
      y: 220,
      width: 400,
      height: 360,
      opacity: 0.5,
    },
    {
      id: 'd-quarter',
      zIndex: 2,
      color: [0.15, 0.35, 0.9, 1],
      x: 580,
      y: 260,
      width: 400,
      height: 360,
      opacity: 0.25,
    },
  ]
}

/**
 * Scenario E — full-stage quad for resize validation.
 * Resize the container and call renderer.resize() to verify viewport update.
 */
export function scenarioE(): DebugRenderItem[] {
  return [
    {
      id: 'e-fullstage',
      zIndex: 0,
      color: [0.1, 0.65, 0.75, 1],
      x: 0,
      y: 0,
      width: SW,
      height: SH,
    },
  ]
}

const SCENARIO_FACTORIES: Record<DebugScenario, () => DebugRenderItem[]> = {
  A: scenarioA,
  B: scenarioB,
  C: scenarioC,
  D: scenarioD,
  E: scenarioE,
}

/** Load a named debug scenario. */
export function loadScenario(scenario: DebugScenario): DebugRenderItem[] {
  return SCENARIO_FACTORIES[scenario]()
}
