/**
 * Save version (TICKET-PF-15): the editor publishes the edited video as the artifact's next version through the
 * `artifact` capability's FILES form, replacing only `elah-input.json` with `{ kind: 'project' }` and the serialised
 * project. Every other file (index.html, the bundle, fonts, assets) is carried over unchanged, every other open view
 * reloads to the new version, and this view keeps running.
 *
 * A file rather than `db`: a project can exceed db's 256 KiB document cap, and the page already loads the file.
 *
 * Footage bytes are never written: footage clips carry only the file's name and size (PF-14), so the saved project
 * references them by name and every viewer reconnects their own copy.
 *
 * Failure design (artifact.d.ts): `conflict` is routine (the shell is already reloading this view to the winner, so
 * the unsaved project is stashed in sessionStorage BEFORE the call); `not_writer` / `not_granted` mean a read-only
 * view; `capability_disabled` means the files form is not available here. Branch on `code`, never on message text.
 * Only `upstream_error` is retried, once, after a short random delay.
 */

import { getCap } from './claudeCaps'

export const INPUT_PATH = 'elah-input.json'

type PublishFile = { content: string; contentType?: string; ifMatch?: string | null }
type PublishResult = { version: string; shas?: Record<string, string> }
export interface ArtifactCap {
  publish(files: Record<string, PublishFile>): Promise<PublishResult>
}

/** Resolves the capability when this view can try a files publish; `null` hides Save (locally, always). */
export async function getArtifactCap(): Promise<ArtifactCap | null> {
  const cap = await getCap<Partial<ArtifactCap>>('artifact')
  return cap && typeof cap.publish === 'function' ? (cap as ArtifactCap) : null
}

/** The new `elah-input.json`: the same contract the page loads, with the project as the source. */
export function savedInputJson(title: string, projectJson: string): string {
  // projectJson is serializeProject's output; spliced in so the project is not parsed and re-stringified.
  const head = JSON.stringify({ format: 'elah-input', version: 1, title })
  return `${head.slice(0, -1)},"source":{"kind":"project","project":${projectJson}}}`
}

export type SaveOutcome =
  | { kind: 'saved'; sha?: string }
  | { kind: 'conflict' }
  | { kind: 'read-only' }
  | { kind: 'unavailable' }
  | { kind: 'too-large'; bytes: number }
  | { kind: 'rate-limited' }
  | { kind: 'failed'; message: string }

const STASH_KEY = 'elah-unsaved-project'

/** Unsaved state kept across the reload a `conflict` triggers (per tab; dropped on any other outcome). */
export interface Stash {
  title: string
  project: string
  at: number
}

function stash(s: Stash | null): void {
  try {
    if (s) sessionStorage.setItem(STASH_KEY, JSON.stringify(s))
    else sessionStorage.removeItem(STASH_KEY)
  } catch {
    /* blocked storage: a conflict then loses only this tab's unsaved edits, which the reload replaces anyway */
  }
}

export function takeStash(): Stash | null {
  try {
    const raw = sessionStorage.getItem(STASH_KEY)
    sessionStorage.removeItem(STASH_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<Stash>
    return typeof s.project === 'string' && typeof s.title === 'string' ? { title: s.title, project: s.project, at: Number(s.at) || 0 } : null
  } catch {
    return null
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Publish `elah-input.json`. `ifMatch` is the file's sha256 as the host last reported it (a previous save's
 * `shas`); without it the call keeps the whole-version compare-and-set, which is equally safe for one file.
 */
export async function saveVersion(cap: ArtifactCap, title: string, projectJson: string, ifMatch?: string): Promise<SaveOutcome> {
  const json = savedInputJson(title, projectJson)
  const bytes = new Blob([json]).size
  const file: PublishFile = { content: json, contentType: 'application/json' }
  if (ifMatch) file.ifMatch = ifMatch
  stash({ title, project: projectJson, at: Date.now() })
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await cap.publish({ [INPUT_PATH]: file })
      stash(null)
      return { kind: 'saved', sha: res.shas?.[INPUT_PATH] }
    } catch (e) {
      const code = (e as { code?: string } | null)?.code
      if (code === 'conflict') return { kind: 'conflict' } // stash kept: the reload restores from it
      if ((code === 'upstream_error' || code === undefined) && attempt === 0) {
        await delay(800 + Math.random() * 1200)
        continue
      }
      stash(null)
      switch (code) {
        case 'not_writer':
        case 'not_granted':
        case 'consent_required':
        case 'not_declared':
          return { kind: 'read-only' }
        case 'capability_disabled':
        case 'capability_removed':
          return { kind: 'unavailable' }
        case 'too_large':
          return { kind: 'too-large', bytes }
        case 'rate_limited':
          return { kind: 'rate-limited' }
        default:
          return { kind: 'failed', message: (e as { message?: string } | null)?.message || String(e) }
      }
    }
  }
}

export const formatBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
