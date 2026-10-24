/**
 * Shared class vocabulary for the landing, taken from DESIGN.md. Values are
 * reused exactly rather than approximated.
 */

export const sans = 'font-[family-name:var(--font-geist-sans),system-ui,sans-serif]'
export const mono = 'font-[family-name:var(--font-geist-mono),ui-monospace,monospace]'
/** Beats the global `:is(h1, h2, h3, h4)` display-font rule. */
export const headingSans = '!font-[family-name:var(--font-geist-sans),system-ui,sans-serif]'

export const MARK = '/landing/elah-mark.png'

/** Outline, not border: it takes no layout space. */
export const outline = '[outline:1px_solid_#F3E2DF] [outline-offset:-0.5px]'

/** Page container and gutters. */
export const container = 'mx-auto w-full max-w-[1440px] px-4 sm:px-8 lg:px-[88px]'

/** Section rhythm. */
export const sectionY = 'py-16 lg:py-[112px]'

export const h2 = `m-0 text-[30px] leading-9 font-semibold tracking-[-1.4px] text-[#1B1416] text-balance sm:text-[40px] sm:leading-[44px] ${headingSans}`
export const lead = `m-0 text-[17px] leading-[27px] text-[#77696B] text-pretty ${sans}`
export const cardTitle = `m-0 text-[22px] font-semibold tracking-[-0.5px] text-[#1B1416] ${headingSans}`
export const cardBody = `m-0 text-[15px] leading-[23px] text-[#77696B] ${sans}`
export const monoLabel = `text-[12px] text-[#77696B] ${mono}`

/** Buttons. Large: hero CTAs. Small: nav, footer. */
const btnBase = `inline-flex items-center justify-center gap-2 rounded-full font-semibold no-underline transition-colors ${sans}`
export const btnLarge = 'px-[26px] py-[14px] text-[15px]'
export const btnSmall = 'px-4 py-[7px] text-[14px]'
export const btnPrimary = `${btnBase} bg-[#F0625A] text-white hover:bg-[#E0544C]`
export const btnSecondary = `${btnBase} bg-white text-[#1B1416] hover:bg-[#FFF5F3] ${outline}`
export const btnDark = `${btnBase} bg-[#1B1416] text-white hover:bg-[#2E2224]`

/** Cards. A light card on a white section; white on blush. */
export const cardLight = `rounded-[20px] bg-[#FFF5F3] p-6 flex flex-col gap-5 ${outline}`
export const cardWhite = `rounded-[20px] bg-white p-6 flex flex-col gap-5 ${outline}`
export const panel = `rounded-[14px] bg-white ${outline}`
export const chip = `rounded-[8px] px-[10px] py-[6px] text-[12px] ${mono}`
