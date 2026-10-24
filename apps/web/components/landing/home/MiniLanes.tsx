import { mono } from './ui'

export interface MiniClip {
  left: number
  width: number
  color: string
  label: string
  /** Keyframe diamonds, as percent positions inside the lane. */
  keys?: number[]
}

export const TRACK = { motion: '#F0625A', mint: '#3DDC97', amber: '#E0A33A' } as const

/**
 * A miniature timeline: solid track-colour clips, ink labels, 7px ink
 * diamonds and an ink playhead (DESIGN.md "Timeline visuals"). Decorative.
 */
export function MiniLanes({ lanes, playhead }: { lanes: MiniClip[][]; playhead: number }) {
  return (
    <div aria-hidden="true" className="relative flex flex-col gap-[4px] bg-white p-3 [outline:1px_solid_#F3E2DF] [outline-offset:-0.5px]">
      {lanes.map((lane, i) => (
        <div key={i} className="relative h-[26px] bg-[#FFF5F3]">
          {lane.map((c) => (
            <div
              key={c.label + c.left}
              className={`absolute top-[2px] bottom-[2px] overflow-hidden px-[6px] text-[10px] font-semibold leading-[22px] text-[#1B1416] ${mono}`}
              style={{ left: `${c.left}%`, width: `${c.width}%`, background: c.color }}
            >
              {c.label}
              {c.keys?.map((k) => (
                <span key={k} className="absolute bottom-[3px] h-[7px] w-[7px] rotate-45 bg-[#1B1416]" style={{ left: `${k}%` }} />
              ))}
            </div>
          ))}
        </div>
      ))}
      <div className="pointer-events-none absolute bottom-3 top-1 w-[2px] bg-[#1B1416]" style={{ left: `calc(12px + ${playhead}% * 0.9)` }}>
        <svg viewBox="0 0 12 10" className="absolute -left-[5px] -top-[2px] h-[10px] w-[12px] fill-[#1B1416]">
          <path d="M0 0 L12 0 L6 10 Z" />
        </svg>
      </div>
    </div>
  )
}
