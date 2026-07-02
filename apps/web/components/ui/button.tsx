import { cn } from '@/lib/utils'
import Link from 'next/link'

interface ButtonProps {
  variant?: 'primary' | 'ghost' | 'link'
  size?: 'sm' | 'md' | 'lg'
  href?: string
  external?: boolean
  children?: React.ReactNode
  className?: string
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
}

const variantStyles = {
  primary: 'bg-primary text-white hover:bg-primary-hover border-transparent',
  ghost:
    'bg-transparent text-on-surface border-outline-variant hover:bg-surface-container hover:text-on-surface',
  link: 'bg-transparent text-primary border-transparent hover:underline px-0',
}

const sizeStyles = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-sm gap-2',
}

export function Button({
  variant = 'ghost',
  size = 'md',
  href,
  external,
  children,
  className,
  onClick,
  disabled,
  type = 'button',
}: ButtonProps) {
  const classes = cn(
    'inline-flex items-center justify-center rounded border font-medium transition-colors cursor-pointer select-none',
    variantStyles[variant],
    sizeStyles[size],
    disabled && 'opacity-50 cursor-not-allowed',
    className,
  )

  if (href) {
    return (
      <Link
        href={href}
        className={classes}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {children as React.ReactNode}
      </Link>
    )
  }

  return (
    <button className={classes} onClick={onClick} disabled={disabled} type={type}>
      {children}
    </button>
  )
}
