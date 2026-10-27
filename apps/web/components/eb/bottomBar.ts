/**
 * Shared look for the site-wide bottom bars (consent, install). An ink bar like
 * the homepage scrub bar (landing DESIGN.md §0), always dark, so it reads the
 * same on the homepage in either theme and on the dark-only pages. Sits above
 * the scrub bar (z-60).
 */
const mono = 'font-[family-name:var(--font-geist-mono),ui-monospace,monospace]'
const btn = `inline-flex h-[36px] items-center justify-center px-4 text-[11px] font-medium uppercase tracking-[0.12em] transition-colors ${mono}`

export const bottomBar = {
  root: 'fixed inset-x-0 bottom-0 z-[70] border-t border-[#2E2E33] bg-[#0E0E10] pb-[env(safe-area-inset-bottom)] text-[#F0EFEA]',
  inner: 'mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-[72px]',
  message: 'flex items-start gap-3',
  marker: 'mt-[6px] h-[8px] w-[8px] shrink-0 bg-[#FF003C]',
  text: 'm-0 text-[14px] leading-[22px] text-[#C9C8C2]',
  link: 'text-[#F0EFEA] underline underline-offset-4 hover:text-[#FF003C]',
  actions: 'flex shrink-0 items-center gap-2',
  secondary: `${btn} border border-[#F0EFEA] text-[#F0EFEA] hover:bg-[#F0EFEA] hover:text-[#0E0E10]`,
  primary: `${btn} bg-[#FF003C] text-[#0E0E10] hover:bg-[#F0EFEA]`,
} as const
