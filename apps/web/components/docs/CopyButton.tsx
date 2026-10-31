'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { label } from '@/components/eb'

/** The copy button in a `Code` block's header. */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => {})
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      }}
      aria-label={copied ? 'Code copied' : 'Copy code'}
      className={`flex items-center gap-1.5 px-3 text-on-surface-variant transition-colors hover:text-on-surface ${label}`}
    >
      {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
