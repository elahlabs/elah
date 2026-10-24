/**
 * Shared class vocabulary for the landing ("edit bay" look, DESIGN.md).
 * Paper and ink, hairline frames, one cyber red for selection, record and
 * playhead. Paper/ink/line are CSS variables (styles/landing.css) so the
 * light and dark themes swap them; cyber red is the same in both.
 */

export const C = {
  paper: 'var(--lp-paper)',
  paper2: 'var(--lp-paper2)',
  card: 'var(--lp-card)',
  ink: 'var(--lp-ink)',
  muted: 'var(--lp-muted)',
  line: 'var(--lp-line)',
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
export const outline = '[outline:1px_solid_var(--lp-line)] [outline-offset:-0.5px]'
export const hair = 'border-[var(--lp-line)]'

/** Page container and gutters. */
export const container = 'mx-auto w-full max-w-[1440px] px-4 sm:px-8 lg:px-[72px]'

/** Section rhythm. */
export const sectionY = 'pb-16 lg:pb-[104px]'

/** Mono uppercase label, the voice of every strip, tag and button. */
export const label = `text-[11px] uppercase tracking-[0.14em] ${mono}`

export const h2 = `m-0 text-[44px] leading-[0.92] font-extrabold tracking-[-0.5px] text-[var(--lp-ink)] text-balance sm:text-[64px] lg:text-[80px] ${display}`
export const lead = `m-0 text-[17px] leading-[27px] text-[var(--lp-muted)] text-pretty ${sans}`
export const cardTitle = `m-0 text-[26px] leading-[1] font-extrabold text-[var(--lp-ink)] ${display}`
export const cardBody = `m-0 text-[15px] leading-[23px] text-[var(--lp-muted)] ${sans}`
export const monoLabel = `${label} text-[var(--lp-muted)]`

/** Buttons: square, mono uppercase. Large: hero CTAs. Small: nav, cards. */
const btnBase = `inline-flex items-center justify-center gap-2 font-medium no-underline transition-colors uppercase tracking-[0.12em] ${mono}`
export const btnLarge = 'h-[52px] px-6 text-[12px]'
export const btnSmall = 'h-[36px] px-4 text-[11px]'
export const btnPrimary = `${btnBase} bg-[var(--lp-ink)] text-[var(--lp-paper)] hover:bg-[#FF003C] hover:text-[#0E0E10]`
export const btnSecondary = `${btnBase} bg-transparent text-[var(--lp-ink)] border border-[var(--lp-ink)] hover:bg-[var(--lp-ink)] hover:text-[var(--lp-paper)]`
export const btnDark = btnPrimary

/** Cards are hairline cells. */
export const cardLight = `bg-[var(--lp-card)] p-6 flex flex-col gap-5 ${outline}`
export const cardWhite = cardLight
export const panel = `bg-[var(--lp-paper)] ${outline}`
export const chip = `px-[10px] py-[6px] text-[11px] uppercase tracking-[0.08em] ${mono}`
