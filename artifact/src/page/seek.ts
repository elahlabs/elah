/**
 * Seek a mounted page: every CSS animation is paused and its `currentTime` set to the playhead, so the page
 * shows exactly the state the browser would show at that moment of normal playback (authored delay,
 * iteration-count, direction and fill-mode all live inside the animation's own timing, which `currentTime`
 * walks through). PLAN-HTML-FIRST section 4: WAAPI seek, not a `--t` variable.
 */

import type { SceneWindow } from './types'

/**
 * Every animation on or under the stage, including pseudo-elements (`subtree: true`). Call it once, right
 * after mount while all animations are still relevant: a finished `fill: none` animation drops out of
 * `getAnimations()`, but a collected object stays seekable.
 */
export function collectAnimations(stageEl: HTMLElement): Animation[] {
  const root = stageEl.getRootNode() as Document | ShadowRoot
  const fromElement = typeof stageEl.getAnimations === 'function' ? stageEl.getAnimations({ subtree: true }) : null
  if (fromElement) return fromElement
  const all = typeof (root as Document).getAnimations === 'function' ? (root as Document).getAnimations() : []
  return all.filter((a) => {
    const t = (a.effect as KeyframeEffect | null)?.target
    return !!t && stageEl.contains(t)
  })
}

/** Pause every animation and put it at `tSeconds`. */
export function seekAnimations(anims: readonly Animation[], tSeconds: number): void {
  const ms = Math.max(0, tSeconds) * 1000
  for (const a of anims) {
    if (a.playState !== 'paused') a.pause()
    a.currentTime = ms
  }
}

/**
 * The scenes named by `[data-scene]` elements, each with the window covered by its own finite animations
 * (delay of the earliest to the end of the latest). Infinite animations (ambient loops) are ignored for the
 * window; a scene with no finite animation spans the whole video.
 */
export function sceneWindows(stageEl: HTMLElement, anims: readonly Animation[], durationSeconds: number): SceneWindow[] {
  const sceneEls = Array.from(stageEl.querySelectorAll<HTMLElement>('[data-scene]'))
  return sceneEls.map((el, i) => {
    let start = Infinity
    let end = -Infinity
    for (const a of anims) {
      const effect = a.effect as KeyframeEffect | null
      const target = effect?.target
      if (!effect || !target || !el.contains(target)) continue
      const t = effect.getComputedTiming()
      const endTime = typeof t.endTime === 'number' ? t.endTime : Number(t.endTime)
      if (!Number.isFinite(endTime)) continue
      const delay = Math.max(0, Number(t.delay ?? 0))
      start = Math.min(start, delay)
      end = Math.max(end, endTime)
    }
    const name = el.getAttribute('data-scene')?.trim() || el.id || `Scene ${i + 1}`
    if (!Number.isFinite(start) || !Number.isFinite(end)) return { name, start: 0, end: durationSeconds }
    return { name, start: Math.min(start / 1000, durationSeconds), end: Math.min(end / 1000, durationSeconds) }
  })
}
