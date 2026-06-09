'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import {
  Clock,
  Cpu,
  Layers,
  Shuffle,
  FileVideo,
  Wand2,
  GitBranch,
  Zap,
  Box,
  type LucideIcon,
} from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  Clock,
  Cpu,
  Layers,
  Shuffle,
  FileVideo,
  Wand2,
  GitBranch,
  Zap,
  Box,
}

interface FeatureCardProps {
  iconName: string
  title: string
  description: string
  tech?: string[]
  className?: string
  index?: number
}

export function FeatureCard({
  iconName,
  title,
  description,
  tech = [],
  className,
  index = 0,
}: FeatureCardProps) {
  const Icon = ICON_MAP[iconName] ?? Box

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4, delay: index * 0.05 }}
      className={cn(
        'group rounded-md border border-outline-variant bg-surface-lowest dark:bg-surface-container p-5 transition-colors hover:border-outline dark:hover:bg-surface-high',
        className
      )}
    >
      <div className="mb-3 flex h-8 w-8 items-center justify-center rounded border border-outline-variant bg-surface-low">
        <Icon className="h-4 w-4 text-on-surface-variant" />
      </div>
      <h3
        className="mb-1.5 text-sm font-semibold text-on-surface"
        style={{ fontFamily: 'var(--font-inter), sans-serif' }}
      >
        {title}
      </h3>
      <p className="text-xs leading-relaxed text-on-surface-variant">{description}</p>
      {tech.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {tech.map((t) => (
            <span
              key={t}
              className="label-mono rounded border border-outline-variant px-1.5 py-0.5 text-2xs text-on-surface-variant"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  )
}
