'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { label } from '@/components/eb'
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
    <div className={cn('group relative border border-outline-variant bg-surface-low overflow-hidden', className)}>
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-outline-variant bg-surface-low pl-4">
        <div className="flex items-center gap-2">
          {filename ? (
            <span className={`text-on-surface-variant ${label}`}>{filename}</span>
          ) : (
            <span className={`text-on-surface-variant ${label}`}>{language}</span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className={cn(label, 'flex items-center gap-1.5 border-l border-outline-variant px-3 py-2.5 text-on-surface-variant transition-colors hover:bg-on-surface hover:text-surface')}
          aria-label={copied ? 'Code copied' : 'Copy code'}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              <span>Copied</span>
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
        tabIndex={0}
        role="region"
        aria-label={filename ? `Code: ${filename}` : `Code sample (${language})`}
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
        'bg-surface-container px-1.5 py-0.5 text-xs text-on-surface break-words',
        className
      )}
      style={{ fontFamily: 'var(--font-geist-mono), monospace' }}
    >
      {children}
    </code>
  )
}
