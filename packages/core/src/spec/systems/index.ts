/**
 * The system registry and `expandSystem` (MI-P3).
 *
 * `expandSystem` is the generic half, like `expandComponents`' walk: it checks
 * the name, clamps the duration, parses params, resolves `targets` against the
 * level, prepares the template, runs the def, and claims the ids it emitted. It
 * never throws; every failure is an issue and the system is skipped, so the
 * rest of the piece still builds.
 */

import type { SpecElement, SpecIssue } from '../types'
import type { AuthoredElement, ComponentContext } from '../components/types'
import { arrange } from './arrange'
import { camera } from './camera'
import { crossMorph } from './crossMorph'
import { freeze } from './freeze'
import { radialPush } from './radialPush'
import { swarm } from './swarm'
import { SYSTEM_NAMES, type SpecSystem, type SystemDef, type SystemName, type SystemOutput } from './types'
import { readParams } from './util'

export * from './types'
export { lowerAuthoredFields } from './lowering'

export const SYSTEM_DEFS: ReadonlyArray<SystemDef> = [swarm, radialPush, freeze, arrange, crossMorph, camera]

export const SYSTEM_REGISTRY: ReadonlyMap<SystemName, SystemDef> = new Map(SYSTEM_DEFS.map((d) => [d.name, d]))

const isSystemName = (v: unknown): v is SystemName => typeof v === 'string' && (SYSTEM_NAMES as ReadonlyArray<string>).includes(v)

export interface ExpandSystemEnv {
  /** The context a system builds with: seeded per system id, energy-scaled `t`, the piece's colours and fonts. */
  makeContext(systemId: string, path: string): ComponentContext
  /** Reserve an id in the whole document; returns the id actually granted (a duplicate is renamed, with a `warn`). */
  claimId(id: string, path: string): string
  /** Expand a template through the normal walk (components inside it too) without keeping its ids reserved. */
  resolveTemplate(template: AuthoredElement, path: string): SpecElement | undefined
  /** Ids emitted by systems earlier in this level, by system id, so `targets` may name a system. */
  emitted: ReadonlyMap<string, ReadonlyArray<string>>
  issues: SpecIssue[]
}

/**
 * Expand one system against the elements currently at its level.
 * `null` means the system was skipped (its issue is already recorded).
 */
export function expandSystem(system: SpecSystem, level: ReadonlyArray<SpecElement>, path: string, env: ExpandSystemEnv): SystemOutput | null {
  const { issues } = env
  const def = isSystemName(system.system) ? SYSTEM_REGISTRY.get(system.system) : undefined
  if (!def) {
    issues.push({ severity: 'error', path: `${path}.system`, code: 'unknown-system', message: `unknown system "${String(system.system)}"` })
    return null
  }

  // Time: finite, and within the def's range (a clamp is a `warn`, like a component's duration).
  let duration = Number.isFinite(system.duration) ? system.duration : def.duration.min
  if (duration < def.duration.min || duration > def.duration.max) {
    const clamped = Math.min(def.duration.max, Math.max(def.duration.min, duration))
    issues.push({ severity: 'warn', path: `${path}.duration`, code: 'clamped', message: `${def.name} runs ${def.duration.min}–${def.duration.max} s; ${duration} s became ${clamped} s` })
    duration = clamped
  }
  const at = Number.isFinite(system.at) ? Math.max(0, system.at) : 0
  const normalised: SpecSystem = { ...system, at, duration }

  const params = readParams(def, system.params, issues, path)

  // Targets: sibling ids, or the id of an earlier system (everything it emitted).
  const targets: SpecElement[] = []
  if (def.targets) {
    const byId = new Map(level.map((e) => [e.id, e]))
    let unknown = false
    ;(system.targets ?? []).forEach((id, i) => {
      const direct = byId.get(id)
      const viaSystem = env.emitted.get(id)
      if (direct) targets.push(direct)
      else if (viaSystem) for (const eid of viaSystem) {
        const e = byId.get(eid)
        if (e) targets.push(e)
      }
      else {
        unknown = true
        issues.push({ severity: 'error', path: `${path}.targets[${i}]`, code: 'unknown-target', message: `${def.name} "${system.id}": no element "${String(id)}" at this level` })
      }
    })
    if (unknown) return null
    const seen = new Set<string>()
    const unique = targets.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
    targets.length = 0
    targets.push(...unique)
    if (targets.length === 0) {
      issues.push({ severity: 'error', path: `${path}.targets`, code: 'missing-targets', message: `${def.name} "${system.id}" needs at least one target` })
      return null
    }
  }

  let template: SpecElement | undefined
  if (def.template) {
    const t = system.template as { kind?: string } | undefined
    if (!t || t.kind === 'component' || t.kind === 'system') {
      issues.push({
        severity: 'error',
        path: `${path}.template`,
        code: 'missing-template',
        message: `${def.name} "${system.id}" needs a template: one raw element (a group is fine; a component or system is not)`,
      })
      return null
    }
    template = env.resolveTemplate(system.template as AuthoredElement, `${path}.template`)
    if (!template) return null
  }

  const ctx = env.makeContext(system.id, path)
  let out: SystemOutput
  try {
    out = def.apply({ system: normalised, params, targets, level, template, ctx })
  } catch (err) {
    issues.push({ severity: 'error', path, code: 'system-failed', message: `${def.name} could not be built: ${err instanceof Error ? err.message : String(err)}` })
    return null
  }

  const prefix = `${system.id}-`
  const emit = out.emit.map((el, i) => {
    if (!el.id.startsWith(prefix)) {
      issues.push({ severity: 'warn', path: `${path}[part ${i}]`, code: 'unscoped-id', message: `${def.name} made a part "${el.id}" not prefixed with "${prefix}"` })
    }
    return { ...el, id: env.claimId(el.id, `${path}[part ${i}]`) }
  })
  return { emit, update: out.update, remove: out.remove }
}
