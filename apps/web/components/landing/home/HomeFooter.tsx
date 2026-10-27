import { SiteFooter } from '@/components/site/SiteFooter'

/** Homepage footer: the shared SiteFooter with the giant wordmark and room for the scrub bar. */
export function HomeFooter({ stars = null }: { stars?: string | null }) {
  return <SiteFooter stars={stars} wordmark reserveScrubBar legal="elah is open source under Apache-2.0." />
}
