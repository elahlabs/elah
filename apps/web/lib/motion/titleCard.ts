import { STARTERS } from './starters'
import { convertHtml, type Converted } from './convert'

const TITLE_CARD = STARTERS[0]

let pending: Promise<Converted> | undefined

/**
 * The title-card starter converted once per page load. The homepage's
 * Write -> Timeline -> Export band and the binding explainer share it, so the
 * HTML scene is measured a single time.
 */
export function getTitleCard(): Promise<Converted> {
  pending ??= convertHtml({
    html: TITLE_CARD.html,
    css: TITLE_CARD.css,
    durationSeconds: TITLE_CARD.durationSeconds,
    stage: TITLE_CARD.stage,
    fps: TITLE_CARD.fps,
  })
  return pending
}
