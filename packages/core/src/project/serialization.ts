import type { Project } from '../types'
import type { TimelineEngine } from '../editor/TimelineEngine'

/**
 * Schema version this build understands. `Project.version` is the wire
 * format itself — no separate envelope — so a future breaking change to
 * the shape bumps this constant and `deserializeProject` gates on it.
 */
const PROJECT_SCHEMA_VERSION = 1

/** Snapshot the engine's current project as JSON. The project's own `version` field is the schema version. */
export function serializeProject(engine: TimelineEngine): string {
  return JSON.stringify(engine.getProject())
}

/** Parse and load a previously serialized project into the engine, replacing its current state. */
export function deserializeProject(engine: TimelineEngine, json: string): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Not valid project JSON: ${message}`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Not a valid project: expected a JSON object')
  }

  const project = parsed as Record<string, unknown>

  if (typeof project.version !== 'number') {
    throw new Error('Not a valid project: missing schema version')
  }
  if (project.version !== PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported project schema version ${project.version} — this build of @elah/core supports version ${PROJECT_SCHEMA_VERSION}`,
    )
  }
  if (!Array.isArray(project.tracks)) {
    throw new Error('Not a valid project: "tracks" must be an array')
  }
  if (typeof project.clips !== 'object' || project.clips === null || Array.isArray(project.clips)) {
    throw new Error('Not a valid project: "clips" must be an object')
  }

  engine.loadProject(project as unknown as Project)
}
