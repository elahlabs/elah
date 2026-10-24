/**
 * Flatten a project's keyframes into table rows: `channel · frame · value ·
 * easing`, each with the key's id (brief 6.2). Pure, so the playground, the
 * binding explainer and the tests share one reading of the data.
 */

import type { Clip, Keyframe, Project } from '@elah/core'

export interface KeyRow {
  clipId: string
  trackId: string
  clipName: string
  clipStart: number
  channel: string
  keyId: string
  /** Clip-relative frame, as stored. */
  frame: number
  value: number
  easing: string
}

export function easingLabel(k: Keyframe): string {
  if (k.hold) return 'hold'
  if (k.steps) return `steps(${k.steps})`
  if (k.spring) return `spring(${k.spring.stiffness}, ${k.spring.damping})`
  if (k.easingBezier) return `cubic-bezier(${k.easingBezier.join(', ')})`
  return k.easing
}

export function clipsOf(project: Pick<Project, 'clips'>): Clip[] {
  return Object.values(project.clips).flat()
}

export function keyRows(project: Pick<Project, 'clips'>): KeyRow[] {
  const rows: KeyRow[] = []
  for (const clip of clipsOf(project)) {
    const channels = clip.keyframes?.channels
    if (!channels) continue
    for (const [channel, track] of Object.entries(channels)) {
      if (!track || track.source.kind !== 'keyframes') continue
      for (const k of track.keys) {
        rows.push({
          clipId: clip.id,
          trackId: clip.trackId,
          clipName: clip.name,
          clipStart: clip.startFrame,
          channel,
          keyId: k.id,
          frame: k.frame,
          value: k.value,
          easing: easingLabel(k),
        })
      }
    }
  }
  return rows.sort((a, b) => a.clipStart + a.frame - (b.clipStart + b.frame) || a.channel.localeCompare(b.channel))
}
