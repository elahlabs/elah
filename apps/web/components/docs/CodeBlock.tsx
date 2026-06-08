'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CodeBlockProps {
  code: string
  language?: string
  filename?: string
  showLineNumbers?: boolean
  className?: string
}

export function CodeBlock({
  code,
  language = 'typescript',
  filename,
  showLineNumbers = false,
  className,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code.trim())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={cn('group relative rounded-md border border-outline-variant bg-surface-low overflow-hidden', className)}>
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container px-4 py-2">
        <div className="flex items-center gap-2">
          {filename ? (
            <span className="font-mono text-xs text-on-surface-variant">{filename}</span>
          ) : (
            <span className="label-mono text-2xs text-on-surface-variant opacity-60">{language}</span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-2xs text-on-surface-variant transition-colors hover:bg-surface-high hover:text-on-surface"
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-tertiary" />
              <span className="text-tertiary">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code content */}
      <pre
        className={cn(
          'overflow-x-auto p-4 text-xs leading-relaxed',
          showLineNumbers && 'pl-0'
        )}
        style={{ fontFamily: 'var(--font-geist-mono), JetBrains Mono, monospace' }}
      >
        <code className={`language-${language} text-on-surface`}>
          {showLineNumbers
            ? code
                .trim()
                .split('\n')
                .map((line, i) => (
                  <span key={i} className="flex">
                    <span className="mr-4 w-6 select-none text-right text-on-surface-variant opacity-40">
                      {i + 1}
                    </span>
                    <span>{line}</span>
                  </span>
                ))
            : code.trim()}
        </code>
      </pre>
    </div>
  )
}

interface InlineCodeProps {
  children: React.ReactNode
  className?: string
}

export function InlineCode({ children, className }: InlineCodeProps) {
  return (
    <code
      className={cn(
        'rounded bg-surface-container px-1.5 py-0.5 text-xs text-on-surface',
        className
      )}
      style={{ fontFamily: 'var(--font-geist-mono), monospace' }}
    >
      {children}
    </code>
  )
}
