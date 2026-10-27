'use client'

import { useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import posthog from 'posthog-js'
import { Check, Copy } from 'lucide-react'

/**
 * Copies a snippet and reports it with the same event the hero install cards
 * use (`install_command_copied`), tagged `package: 'snippet'`.
 */
export function CopyButton({ text, label = 'Copy snippet' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const reduce = useReducedMotion()

  function copy() {
    try {
      navigator.clipboard.writeText(text)
    } catch {
      // clipboard may be unavailable (insecure context) — still flash feedback
    }
    posthog.capture('install_command_copied', { command: text, package: 'snippet' })
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1400)
  }

  return (
    <button
      type="button"
      className="inline-flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center border border-outline-variant bg-transparent text-on-surface-variant transition-colors hover:border-on-surface hover:text-on-surface"
      onClick={copy}
      title={label}
      aria-label={label}
    >
      <motion.span
        key={copied ? 'done' : 'idle'}
        initial={copied && !reduce ? { scale: 0.3, rotate: -40 } : false}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 520, damping: 14 }}
        style={{ display: 'inline-flex' }}
      >
        {copied ? <Check size={14} className="text-on-surface" /> : <Copy size={14} />}
      </motion.span>
    </button>
  )
}
