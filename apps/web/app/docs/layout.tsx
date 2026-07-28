import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import { DocsSidebar } from '@/components/docs/DocsSidebar'
import { DocsMobileNav } from '@/components/docs/DocsMobileNav'

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Navbar />
      {/* Outside the max-w row so the sub-bar's border spans the full width. */}
      <DocsMobileNav />
      <div className="mx-auto flex w-full max-w-7xl flex-1 px-4 sm:px-6">
        <DocsSidebar />
        <main id="main" className="min-w-0 flex-1 py-8 md:px-8 md:py-10">
          {children}
        </main>
      </div>
      <Footer />
    </div>
  )
}
