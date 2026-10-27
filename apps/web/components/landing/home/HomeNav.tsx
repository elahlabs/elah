import { SiteNav } from '@/components/site/SiteNav'

/** Homepage nav: the shared SiteNav with the star count and no version/Discord cells. */
export function HomeNav({ stars = null }: { stars?: string | null }) {
  return <SiteNav stars={stars} extras={false} />
}
