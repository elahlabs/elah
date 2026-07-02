'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowRight, Github } from 'lucide-react'

export function CTASection() {
  return (
    <section className="border-t border-outline-variant bg-surface py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="flex flex-col items-start gap-8 md:flex-row md:items-center md:justify-between"
        >
          <div>
            <div className="label-mono mb-3 text-2xs text-on-surface-variant opacity-60">
              Ready to build
            </div>
            <h2
              className="text-2xl font-semibold tracking-tight text-on-surface md:text-3xl"
              style={{ fontFamily: 'var(--font-inter), sans-serif' }}
            >
              Start building professional
              <br />
              video tooling on the web.
            </h2>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-on-surface-variant">
              elah is open source. Drop in the timeline and preview components, wire your demuxer,
              and ship.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/docs/getting-started"
              className="inline-flex items-center gap-2 rounded bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
            >
              Get Started
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="https://github.com/elahlabs/elah"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded border border-outline-variant bg-transparent px-5 py-2.5 text-sm font-medium text-on-surface transition-colors hover:bg-surface-container"
            >
              <Github className="h-3.5 w-3.5" />
              View on GitHub
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
