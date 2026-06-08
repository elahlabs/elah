import { Navbar } from '@/components/marketing/Navbar'
import { Footer } from '@/components/marketing/Footer'
import { DocsSidebar } from '@/components/docs/DocsSidebar'

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Navbar />
      <div className="mx-auto flex w-full max-w-7xl flex-1 px-4 sm:px-6">
        <DocsSidebar />
        <main className="min-w-0 flex-1 py-10">{children}</main>
      </div>
      <Footer />
    </div>
  )
}
