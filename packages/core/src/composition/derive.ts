import { isRecoverableMediaSrc } from '../editor/projectDocument'
import type { Clip, Project } from '../types'
import type { Binding, ProjectComposition, PropDef } from './types'

/**
 * A prop-name identifier from free text: words split on non-alphanumerics,
 * camelCased, digit-prefixed with `_` if the result would start with one, cut
 * to 36 characters. `''` in, `''` out — a caller falls back to a fixed name.
 */
export function propIdentifier(raw: string): string {
  const words = raw.split(/[^A-Za-z0-9]+/).filter((w) => w.length > 0)
  if (words.length === 0) return ''
  const parts = words.map((w, i) => {
    const lower = w.toLowerCase()
    return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1)
  })
  let out = parts.join('')
  if (/^[0-9]/.test(out)) out = `_${out}`
  return out.slice(0, 36)
}

/** `base`, or `base2`, `base3`… — the first not in `used`. `used` is not modified. */
export function uniquePropName(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base
  let i = 2
  for (;;) {
    const candidate = `${base}${i}`
    if (!used.has(candidate)) return candidate
    i++
  }
}

interface WalkedClip {
  clip: Clip
  /** Clip path: 'abc' at the root, 'abc/def' for a clip inside compound 'abc'. */
  path: string
}

/** Tracks by `order` ascending, clips within a track by `startFrame` ascending; a
 *  compound clip's child project is walked right after it, before its next sibling. */
function walkClips(project: Project, prefix: string, out: WalkedClip[]): void {
  const tracks = [...project.tracks].sort((a, b) => a.order - b.order)
  for (const t of tracks) {
    const clips = [...(project.clips[t.id] ?? [])].sort((a, b) => a.startFrame - b.startFrame)
    for (const c of clips) {
      out.push({ clip: c, path: `${prefix}${c.id}` })
      if (c.type === 'compound' && c.compound?.project) {
        walkClips(c.compound.project, `${prefix}${c.id}/`, out)
      }
    }
  }
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i

/**
 * A composition for a project that has none, so any template can be driven by
 * props: every text, every solid shape fill and every re-fetchable media source
 * (compounds included, with 'parent/child' paths). Returns the project's own
 * composition untouched when it has one; `undefined` when nothing is bindable.
 */
export function deriveComposition(project: Project): ProjectComposition | undefined {
  if (project.composition) return project.composition

  const walked: WalkedClip[] = []
  walkClips(project, '', walked)

  const props: PropDef[] = []
  const bindings: Binding[] = []
  const used = new Set<string>()

  for (const { clip, path } of walked) {
    if (clip.type === 'text' && typeof clip.content === 'string' && clip.content.length > 0) {
      const name = uniquePropName(propIdentifier(clip.name || 'text') || 'text', used)
      used.add(name)
      props.push({ name, type: 'text', default: clip.content, label: clip.name.trim() || 'Text' })
      bindings.push({ clipId: path, path: 'text', prop: name })
      continue
    }

    if (
      clip.type === 'shape' &&
      typeof clip.shapeFill === 'string' &&
      HEX_COLOR_RE.test(clip.shapeFill) &&
      clip.shapeFillPaint === undefined
    ) {
      // A shape with a gradient/paint fill (PV-P6a) is not a flat-colour prop.
      const name = uniquePropName(propIdentifier(`${clip.name} Color`) || 'color', used)
      used.add(name)
      props.push({ name, type: 'color', default: clip.shapeFill.toLowerCase(), label: `${clip.name} colour` })
      bindings.push({ clipId: path, path: 'shapeFill', prop: name })
      continue
    }

    if ((clip.type === 'image' || clip.type === 'video' || clip.type === 'audio') && isRecoverableMediaSrc(clip.src)) {
      const name = uniquePropName(propIdentifier(clip.name || clip.type) || clip.type, used)
      used.add(name)
      props.push({ name, type: clip.type, default: clip.src, label: clip.name || clip.type })
      bindings.push({ clipId: path, path: 'src', prop: name })
    }
  }

  if (props.length === 0) return undefined
  return { props, bindings }
}
