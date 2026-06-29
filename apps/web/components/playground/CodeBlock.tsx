'use client'

import { useState } from 'react'

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
          className="text-[9px] text-ed-text-muted hover:text-ed-text uppercase tracking-wide cursor-pointer"
        >
          {copied ? '✓ copied' : 'copy'}
        </button>
      </div>
      <pre className="text-[10px] font-mono leading-relaxed text-ed-text whitespace-pre overflow-auto rounded-md border border-ed-border bg-ed-bg p-2">
        {code}
      </pre>
    </div>
  )
}
