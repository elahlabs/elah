'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Play, Layers, Clock, Cpu } from 'lucide-react'
import { btnSecondary, btnSmall, cardTitle, label, outline } from '@/components/eb'
import { trackPlaygroundLaunch } from '@/lib/analytics'

interface PlaygroundCardProps {
  title: string
  description: string
  techLabels: string[]
  href: string
  status?: 'live' | 'beta' | 'preview'
  variant?: 'full' | 'timeline' | 'demo'
  index?: number
}

// Status dots are the one place the mint/amber status colours are allowed.
const statusDot = {
  live: '#3DDC97',
  beta: '#E0A33A',
  preview: '#E0A33A',
}

const variantIcons = {
  full: Layers,
  timeline: Clock,
  demo: Cpu,
}

const INK = 'var(--color-on-surface)'

/** `color` at `pct`% opacity; works with CSS-variable colours, unlike hex+alpha. */
const tint = (color: string, pct: number) => `color-mix(in oklab, ${color} ${pct}%, transparent)`

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
  const accentColor = INK

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4, delay: index * 0.07 }}
      className={`group flex flex-col bg-surface-low ${outline}`}
    >
      {/* Preview area */}
      <div className="relative flex h-40 items-center justify-center border-b border-outline-variant bg-surface-container">
        {/* Mock editor screen */}
        <div className="absolute inset-4 overflow-hidden bg-surface" style={{ outline: `1px solid ${tint(INK, 18)}` }}>
          {variant === 'full' && <FullEditorPreview color={accentColor} />}
          {variant === 'timeline' && <TimelinePreview color={accentColor} />}
          {variant === 'demo' && <DemoPreview color={accentColor} />}
        </div>

        {/* Status badge */}
        <div className={`absolute right-3 top-3 flex items-center gap-2 bg-surface px-2 py-[3px] text-on-surface ${label} ${outline}`}>
          <span aria-hidden className="h-[6px] w-[6px]" style={{ backgroundColor: statusDot[status] }} />
          {status}
        </div>
      </div>

      {/* Card body */}
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-on-surface" />
            <h3 className={cardTitle}>{title}</h3>
          </div>
        </div>

        <p className="mb-4 flex-1 text-[15px] leading-[23px] text-on-surface-variant">{description}</p>

        <div className="mb-4 flex flex-wrap gap-2">
          {techLabels.map((tech) => (
            <span
              key={tech}
              className={`bg-surface px-2 py-[3px] text-on-surface-variant ${label} ${outline}`}
            >
              {tech}
            </span>
          ))}
        </div>

        <Link
          href={href}
          className={`${btnSecondary} ${btnSmall}`}
          onClick={() => trackPlaygroundLaunch({ source: 'playground_card', title, href, variant, status })}
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
        <div className="w-12 border-r border-outline-variant bg-surface-container" />
        <div className="flex flex-1 items-center justify-center">
          <div className="h-10 w-16 border border-outline-variant bg-surface-container flex items-center justify-center">
            <Play className="h-4 w-4 text-on-surface-variant ml-0.5" />
          </div>
        </div>
      </div>
      <div className="border-t border-outline-variant p-1">
        {[1, 2, 3].map((i) => (
          <div key={i} className="mb-0.5 flex gap-1">
            <div className="h-2.5 w-6 bg-outline-variant" />
            <div
              className="h-2.5"
              style={{ width: `${30 + i * 10}%`, backgroundColor: tint(color, 38) }}
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
          <div key={i} className="flex-1 border-l border-outline-variant h-2" />
        ))}
      </div>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="mb-1 flex items-center gap-1">
          <div className="h-3 w-6 bg-outline-variant" />
          <div className="relative flex-1" style={{ height: '12px', background: 'var(--color-surface-container)' }}>
            <div
              className="absolute inset-y-0.5"
              style={{
                left: `${(i - 1) * 15}%`,
                width: `${20 + i * 8}%`,
                backgroundColor: tint(color, 50),
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
            className="h-10 w-16 border border-outline-variant"
            style={{ backgroundColor: tint(color, i % 2 === 0 ? 19 : 8) }}
          />
        ))}
      </div>
    </div>
  )
}
