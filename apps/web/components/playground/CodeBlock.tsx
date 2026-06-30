'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Small read-only code surface with a copy button. Playground-only. */
export function CodeBlock({ label, code }: { label?: string; code: string }) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        {label ? (
          <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-ed-text-muted/60">
            {label}
          </span>
        ) : (
          <span />
        )}
        <button
          onClick={copy}
          title={copied ? 'Copied' : 'Copy'}
          aria-label={copied ? 'Copied' : 'Copy'}
          className={cn(
            'inline-flex h-6 w-6 items-center justify-center rounded transition-colors cursor-pointer',
            copied
              ? 'text-emerald-400'
              : 'text-ed-text-muted hover:text-ed-text hover:bg-ed-elevated',
          )}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre className="text-[10px] font-mono leading-relaxed text-ed-text whitespace-pre overflow-auto rounded-md border border-ed-border bg-ed-bg p-2">
        {code}
      </pre>
    </div>
  )
}
