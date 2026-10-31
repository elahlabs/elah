import { container } from '@/components/eb'
import { SiteNav } from '@/components/site/SiteNav'
import { SiteFooter } from '@/components/site/SiteFooter'
import { DocsSidebar } from '@/components/docs/DocsSidebar'
import { DocsMobileNav } from '@/components/docs/DocsMobileNav'
import { DocsAskAi } from '@/components/docs/DocsAskAi'

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      {/* Bar, not the floating pill: the sidebar is persistent and long docs should not lose their nav. */}
      <SiteNav variant="bar" />
      {/* Outside the max-w row so the sub-bar's border spans the full width. */}
      <DocsMobileNav />
      <div className={`${container} flex flex-1`}>
        <DocsSidebar />
        <main id="main" className="min-w-0 flex-1 py-8 md:px-8 md:py-10">
          <DocsAskAi />
          {children}
        </main>
      </div>
      <SiteFooter />
    </div>
  )
}
