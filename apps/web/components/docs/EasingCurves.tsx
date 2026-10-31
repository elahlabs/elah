import { DEFAULT_TEXT_TRANSFORM, TEXT_ANIMATION_EASINGS, sampleTextAnimation } from '@elah/core'
import type { TextAnimationEasing } from '@elah/core'
import { label } from '@/components/eb'

const STEPS = 80
const W = 76
const H = 48
/** Value range drawn: room for back and elastic to overshoot past 0 and 1. */
const LO = -0.45
const HI = 1.45

/**
 * The eased progress of a curve, read back from the public sampler: an entry
 * that travels 1 stage-width on x, sampled frame by frame. Plotting through
 * `sampleTextAnimation` means the chart is the engine's own curve, not a copy.
 */
function curve(ease: TextAnimationEasing): number[] {
  const rest = DEFAULT_TEXT_TRANSFORM
  return Array.from({ length: STEPS + 1 }, (_, f) => {
    const s = sampleTextAnimation({
      animation: { durationFrames: STEPS, inMotion: { offsetX: 1, ease } },
      localFrame: f,
      clipDurationFrames: STEPS * 10,
      transform: rest,
      defaultTransform: rest,
    })
    return 1 - ((s.transform?.x ?? rest.x) - rest.x)
  })
}

function Plot({ ease }: { ease: TextAnimationEasing }) {
  const y = (v: number) => H - ((v - LO) / (HI - LO)) * H
  const pts = curve(ease)
    .map((v, i) => `${((i / STEPS) * W).toFixed(2)},${y(v).toFixed(2)}`)
    .join(' ')
  return (
    <figure className="m-0 flex flex-col items-center gap-1">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden className="overflow-visible">
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="stroke-outline-variant" strokeWidth={1} />
        <line x1={0} x2={W} y1={y(1)} y2={y(1)} className="stroke-outline-variant" strokeWidth={1} strokeDasharray="2 2" />
        <polyline points={pts} fill="none" className="stroke-on-surface" strokeWidth={1.5} strokeLinejoin="round" />
      </svg>
      <figcaption className="font-[family-name:var(--font-geist-mono),monospace] text-[11px] text-on-surface-variant">{ease}</figcaption>
    </figure>
  )
}

/** Every easing curve, grouped by family (in / out / in-out), drawn from the engine. */
export function EasingCurves() {
  const families = new Map<string, TextAnimationEasing[]>()
  for (const e of TEXT_ANIMATION_EASINGS) {
    const family = e.replace(/-(in-out|in|out)$/, '')
    families.set(family, [...(families.get(family) ?? []), e])
  }
  return (
    <div className="my-6 border border-outline-variant">
      <div className={`flex justify-between border-b border-outline-variant bg-surface-low px-4 py-2 text-on-surface-variant ${label}`}>
        <span>{TEXT_ANIMATION_EASINGS.length} curves</span>
        <span>solid line 0 · dashed line 1</span>
      </div>
      {/* Hairlines are the 1px gaps showing the grid's background. linear spans both columns so the ten families pair up. */}
      <div className="grid gap-px bg-outline-variant sm:grid-cols-2">
        {[...families].map(([family, eases]) => (
          <div key={family} className={`flex flex-col gap-3 bg-surface px-4 py-4 ${family === 'linear' ? 'sm:col-span-2' : ''}`}>
            <span className={`text-on-surface ${label}`}>{family}</span>
            <div className="flex flex-wrap gap-x-3 gap-y-3">
              {eases.map((e) => (
                <Plot key={e} ease={e} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
