'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

// Icon-only "go back" control shared by the playground shell (Timeline/Raw
// nav) and the production editor's merged header. Uses browser history
// instead of a hard link to /playgrounds so it returns wherever the user
// actually came from.
export function BackButton({ className }: { className?: string }) {
  const router = useRouter()

  return (
    <button
      type="button"
      onClick={() => router.back()}
      title="Back"
      className={cn(
        'inline-flex items-center justify-center w-7 h-7 rounded-md text-ed-text bg-ed-elevated border border-ed-border hover:border-ed-accent/60 hover:text-ed-accent transition-colors',
        className,
      )}
    >
      <ChevronLeft size={16} />
    </button>
  )
}
