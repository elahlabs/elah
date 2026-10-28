import Link from 'next/link'
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps } from 'react'
import { btnLarge, btnPrimary, btnSecondary, btnSmall } from './tokens'

type Variant = 'primary' | 'secondary'
type Size = 'lg' | 'sm'

function cls(variant: Variant, size: Size, className?: string) {
  return [variant === 'primary' ? btnPrimary : btnSecondary, size === 'lg' ? btnLarge : btnSmall, className]
    .filter(Boolean)
    .join(' ')
}

type CommonProps = { variant?: Variant; size?: Size }

export function ButtonLink({
  variant = 'primary',
  size = 'lg',
  className,
  ...rest
}: CommonProps & ComponentProps<typeof Link> & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <Link {...rest} className={cls(variant, size, className)} />
}

export function Button({
  variant = 'primary',
  size = 'lg',
  className,
  type = 'button',
  ...rest
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} {...rest} className={cls(variant, size, className)} />
}
