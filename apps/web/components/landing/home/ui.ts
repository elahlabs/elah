/**
 * Shared class vocabulary for the landing ("edit bay" look, DESIGN.md).
 * Paper and ink, hairline frames, one cyber red for selection, record and
 * playhead. Values are reused exactly rather than approximated.
 */

export const C = {
  paper: '#F0EFEA',
  paper2: '#E8E6E0',
  card: '#F7F6F2',
  ink: '#0E0E10',
  muted: '#5E5D58',
  line: '#D9D7D0',
  red: '#FF003C',
} as const

export const sans = 'font-[family-name:var(--font-geist-sans),system-ui,sans-serif]'
export const mono = 'font-[family-name:var(--font-geist-mono),ui-monospace,monospace]'
/** Condensed display face. The `!` beats the global `:is(h1, h2, h3, h4)` display-font rule. */
export const display = '!font-[family-name:var(--font-lp-display),system-ui,sans-serif] uppercase'
/** Kept for older call sites. */
export const headingSans = display

export const MARK = '/landing/elah-mark.png'

/** Hairline as an outline: it takes no layout space. */
export const outline = '[outline:1px_solid_#D9D7D0] [outline-offset:-0.5px]'
export const hair = 'border-[#D9D7D0]'

/** Page container and gutters. */
export const container = 'mx-auto w-full max-w-[1440px] px-4 sm:px-8 lg:px-[72px]'

/** Section rhythm. */
export const sectionY = 'pb-16 lg:pb-[104px]'

/** Mono uppercase label, the voice of every strip, tag and button. */
export const label = `text-[11px] uppercase tracking-[0.14em] ${mono}`

export const h2 = `m-0 text-[44px] leading-[0.92] font-extrabold tracking-[-0.5px] text-[#0E0E10] text-balance sm:text-[64px] lg:text-[80px] ${display}`
export const lead = `m-0 text-[17px] leading-[27px] text-[#5E5D58] text-pretty ${sans}`
export const cardTitle = `m-0 text-[26px] leading-[1] font-extrabold text-[#0E0E10] ${display}`
export const cardBody = `m-0 text-[15px] leading-[23px] text-[#5E5D58] ${sans}`
export const monoLabel = `${label} text-[#5E5D58]`

/** Buttons: square, mono uppercase. Large: hero CTAs. Small: nav, cards. */
const btnBase = `inline-flex items-center justify-center gap-2 font-medium no-underline transition-colors uppercase tracking-[0.12em] ${mono}`
export const btnLarge = 'h-[52px] px-6 text-[12px]'
export const btnSmall = 'h-[36px] px-4 text-[11px]'
export const btnPrimary = `${btnBase} bg-[#0E0E10] text-[#F0EFEA] hover:bg-[#FF003C] hover:text-[#0E0E10]`
export const btnSecondary = `${btnBase} bg-transparent text-[#0E0E10] border border-[#0E0E10] hover:bg-[#0E0E10] hover:text-[#F0EFEA]`
export const btnDark = btnPrimary

/** Cards are hairline cells. */
export const cardLight = `bg-[#F7F6F2] p-6 flex flex-col gap-5 ${outline}`
export const cardWhite = cardLight
export const panel = `bg-[#F0EFEA] ${outline}`
export const chip = `px-[10px] py-[6px] text-[11px] uppercase tracking-[0.08em] ${mono}`
