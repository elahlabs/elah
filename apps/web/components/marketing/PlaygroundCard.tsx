'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Play, Layers, Clock, Cpu } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PlaygroundCardProps {
  title: string
  description: string
  techLabels: string[]
  href: string
  status?: 'live' | 'beta' | 'preview'
  variant?: 'full' | 'timeline' | 'demo'
  index?: number
}

const statusStyles = {
  live:    'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-900/50',
  beta:    'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-900/50',
  preview: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-900/50',
}

const variantIcons = {
  full: Layers,
  timeline: Clock,
  demo: Cpu,
}

const variantColors = {
  full: '#b7102a',
  timeline: '#485f84',
  demo: '#006860',
}

export function PlaygroundCard({
  title,
  description,
  techLabels,
  href,
  status = 'live',
  variant = 'full',
  index = 0,
}: PlaygroundCardProps) {
  const Icon = variantIcons[variant]
  const accentColor = variantColors[variant]

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4, delay: index * 0.07 }}
      className="group flex flex-col overflow-hidden rounded-md border border-outline-variant bg-surface-lowest dark:bg-surface-container transition-colors hover:border-outline"
    >
      {/* Preview area */}
      <div
        className="relative flex items-center justify-center"
        style={{ height: '160px', background: '#0a0a0a' }}
      >
        {/* Mock editor screen */}
        <div className="absolute inset-4 overflow-hidden rounded border border-white/10 bg-[#111]">
          {variant === 'full' && <FullEditorPreview color={accentColor} />}
          {variant === 'timeline' && <TimelinePreview color={accentColor} />}
          {variant === 'demo' && <DemoPreview color={accentColor} />}
        </div>

        {/* Status badge */}
        <div className={cn('absolute right-3 top-3 rounded border px-2 py-0.5 text-2xs font-medium', statusStyles[status])}>
          {status}
        </div>
      </div>

      {/* Card body */}
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div
              className="flex h-6 w-6 items-center justify-center rounded"
              style={{ backgroundColor: accentColor + '18', border: `1px solid ${accentColor}30` }}
            >
              <Icon className="h-3.5 w-3.5" style={{ color: accentColor }} />
            </div>
            <h3
              className="text-sm font-semibold text-on-surface"
              style={{ fontFamily: 'var(--font-inter), sans-serif' }}
            >
              {title}
            </h3>
          </div>
        </div>

        <p className="mb-4 flex-1 text-xs leading-relaxed text-on-surface-variant">{description}</p>

        <div className="flex flex-wrap gap-1 mb-4">
          {techLabels.map((label) => (
            <span
              key={label}
              className="label-mono rounded border border-outline-variant px-1.5 py-0.5 text-2xs text-on-surface-variant"
            >
              {label}
            </span>
          ))}
        </div>

        <Link
          href={href}
          className="flex items-center justify-center gap-2 rounded border px-3 py-2 text-xs font-medium transition-colors"
          style={{
            borderColor: accentColor + '40',
            color: accentColor,
            backgroundColor: accentColor + '08',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = accentColor + '14'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = accentColor + '08'
          }}
        >
          <Play className="h-3 w-3" />
          Launch Playground
        </Link>
      </div>
    </motion.div>
  )
}

function FullEditorPreview({ color }: { color: string }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1">
        <div className="w-12 border-r border-white/10 bg-black/40" />
        <div className="flex flex-1 items-center justify-center">
          <div className="h-10 w-16 rounded border border-white/10 bg-white/5 flex items-center justify-center">
            <Play className="h-4 w-4 text-white/60 ml-0.5" />
          </div>
        </div>
      </div>
      <div className="border-t border-white/10 p-1">
        {[1, 2, 3].map((i) => (
          <div key={i} className="mb-0.5 flex gap-1">
            <div className="h-2.5 w-6 rounded-sm bg-white/10" />
            <div
              className="h-2.5 rounded-sm"
              style={{ width: `${30 + i * 10}%`, backgroundColor: color + '60' }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function TimelinePreview({ color }: { color: string }) {
  return (
    <div className="flex h-full flex-col p-2">
      <div className="mb-1 flex gap-0.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex-1 border-l border-white/10 h-2" />
        ))}
      </div>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="mb-1 flex items-center gap-1">
          <div className="h-3 w-6 rounded-sm bg-white/10" />
          <div className="relative flex-1" style={{ height: '12px', background: '#111' }}>
            <div
              className="absolute inset-y-0.5 rounded-sm"
              style={{
                left: `${(i - 1) * 15}%`,
                width: `${20 + i * 8}%`,
                backgroundColor: color + '80',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function DemoPreview({ color }: { color: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="grid grid-cols-2 gap-1 p-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-10 w-16 rounded border border-white/10"
            style={{ backgroundColor: color + (i % 2 === 0 ? '30' : '15') }}
          />
        ))}
      </div>
    </div>
  )
}
