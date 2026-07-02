import { cn } from '@/lib/utils'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'outline' | 'tech' | 'success' | 'warning'
  className?: string
}

const variantStyles = {
  default: 'bg-surface-high text-on-surface-variant border-transparent',
  outline: 'bg-transparent text-on-surface-variant border-outline-variant',
  tech: 'bg-surface-low text-on-surface-variant border-outline-variant font-mono',
  success: 'bg-green-50 text-green-800 border-green-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-2 py-0.5 text-2xs font-medium tracking-wide',
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
