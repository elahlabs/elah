/**
 * Shared class vocabulary for the landing ("edit bay" look, DESIGN.md).
 * Paper and ink, hairline frames, one cyber red for selection, record and
 * playhead. Paper/ink/line are the site --color-* tokens (styles/globals.css) so the
 * light and dark themes swap them; cyber red is the same in both.
 */

export const C = {
  paper: 'var(--color-surface)',
  paper2: 'var(--color-surface-container)',
  card: 'var(--color-surface-low)',
  ink: 'var(--color-on-surface)',
  muted: 'var(--color-on-surface-variant)',
  line: 'var(--color-outline-variant)',
  red: '#FF003C',
} as const

export const sans = 'font-[family-name:var(--font-geist-sans),system-ui,sans-serif]'
export const mono = 'font-[family-name:var(--font-geist-mono),ui-monospace,monospace]'
/** Condensed display face. The `!` beats the global `:is(h1, h2, h3, h4)` display-font rule. */
export const display = '!font-[family-name:var(--font-display),system-ui,sans-serif] uppercase'
/** Kept for older call sites. */
export const headingSans = display

export const MARK = '/landing/elah-mark.png'

/** Hairline as an outline: it takes no layout space. */
export const outline = '[outline:1px_solid_var(--color-outline-variant)] [outline-offset:-0.5px]'
export const hair = 'border-[var(--color-outline-variant)]'

/** Page container and gutters. */
export const container = 'mx-auto w-full max-w-[1440px] px-4 sm:px-8 lg:px-[72px]'

/** Section rhythm. */
export const sectionY = 'pb-16 lg:pb-[104px]'

/** Mono uppercase label, the voice of every strip, tag and button. */
export const label = `text-[11px] uppercase tracking-[0.14em] ${mono}`

export const h2 = `m-0 text-[44px] leading-[0.92] font-extrabold tracking-[-0.5px] text-[var(--color-on-surface)] text-balance sm:text-[64px] lg:text-[80px] ${display}`
export const lead = `m-0 text-[17px] leading-[27px] text-[var(--color-on-surface-variant)] text-pretty ${sans}`
export const cardTitle = `m-0 text-[26px] leading-[1] font-extrabold text-[var(--color-on-surface)] ${display}`
export const cardBody = `m-0 text-[15px] leading-[23px] text-[var(--color-on-surface-variant)] ${sans}`
export const monoLabel = `${label} text-[var(--color-on-surface-variant)]`

/** Buttons: square, mono uppercase. Large: hero CTAs. Small: nav, cards. */
const btnBase = `inline-flex items-center justify-center gap-2 font-medium no-underline transition-colors uppercase tracking-[0.12em] ${mono}`
export const btnLarge = 'h-[52px] px-6 text-[12px]'
export const btnSmall = 'h-[36px] px-4 text-[11px]'
export const btnPrimary = `${btnBase} bg-[var(--color-on-surface)] text-[var(--color-surface)] hover:bg-[#FF003C] hover:text-[#0E0E10]`
export const btnSecondary = `${btnBase} bg-transparent text-[var(--color-on-surface)] border border-[var(--color-on-surface)] hover:bg-[var(--color-on-surface)] hover:text-[var(--color-surface)]`
export const btnDark = btnPrimary

/** Cards are hairline cells. */
export const cardLight = `bg-[var(--color-surface-low)] p-6 flex flex-col gap-5 ${outline}`
export const cardWhite = cardLight
export const panel = `bg-[var(--color-surface)] ${outline}`
export const chip = `px-[10px] py-[6px] text-[11px] uppercase tracking-[0.08em] ${mono}`
