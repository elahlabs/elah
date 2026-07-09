'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, Copy, Play } from 'lucide-react'

function InstallCommand() {
  const command = 'npm install @elah/editor'
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard?.writeText(command).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="group inline-flex items-center gap-3 rounded border border-outline-variant bg-surface-container px-3.5 py-2.5 font-mono text-xs text-on-surface transition-colors hover:border-outline"
      title="Copy to clipboard"
    >
      <span className="select-none text-primary">$</span>
      <span>{command}</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 text-tertiary" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-on-surface-variant opacity-50 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  )
}

// Entrance animation is the CSS `.fade-up` class (globals.css), not
// framer-motion: motion's initial={opacity: 0} is server-rendered inline, so
// the hero — including the LCP text — stayed invisible until hydration. The
// headline and subheadline get no animation at all so LCP lands at first paint.
const fadeUp = (step: number) => ({
  className: 'fade-up',
  style: { '--fade-delay': step } as React.CSSProperties,
})

export function HeroSection() {
  return (
    <section className="relative overflow-hidden border-b border-outline-variant bg-surface pb-20 pt-24 md:pt-32">
      {/* Subtle grid background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage: `
            linear-gradient(to right, var(--color-outline-variant) 1px, transparent 1px),
            linear-gradient(to bottom, var(--color-outline-variant) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
        }}
      />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        <div className="max-w-3xl">
          {/* Technical badge */}
          <div {...fadeUp(0)}>
            <div className="mb-6 flex items-center gap-2">
              <span className="label-mono rounded border border-outline-variant bg-surface-container px-2.5 py-1 text-2xs text-on-surface-variant">
                Open Source · ECL v1.0
              </span>
              <span className="label-mono rounded border border-outline-variant bg-surface-container px-2.5 py-1 text-2xs text-on-surface-variant">
                WebCodecs + WebGL2
              </span>
            </div>
          </div>

          {/* Headline — no entrance animation: this is the LCP element */}
          <h1
            className="text-4xl font-semibold leading-tight tracking-tight text-on-surface md:text-5xl lg:text-6xl"
            style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif' }}
          >
            Browser-Native
            <br />
            <span className="text-primary">Video Infrastructure</span>
          </h1>

          {/* Subheadline — static for the same reason */}
          <p
            className="mt-5 max-w-2xl text-base leading-relaxed text-on-surface-variant md:text-lg"
            style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif' }}
          >
            elah provides the timeline, rendering, and editing foundation for
            professional creative applications built entirely on the web. Engine-first,
            renderer-agnostic, scalable from prototype to production.
          </p>

          {/* Framework support */}
          <div {...fadeUp(1)}>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="label-mono text-2xs text-on-surface-variant opacity-90">
                Framework-agnostic core ·
              </span>
              <span className="label-mono rounded border border-primary/40 bg-primary/10 px-2.5 py-1 text-2xs text-primary">
                Next.js
              </span>
              <span className="label-mono rounded border border-primary/40 bg-primary/10 px-2.5 py-1 text-2xs text-primary">
                React
              </span>
              <span className="label-mono rounded border border-outline-variant bg-surface-container px-2.5 py-1 text-2xs text-on-surface-variant">
                React Native · experimental
              </span>
              <span className="label-mono rounded border border-dashed border-outline-variant bg-surface-container px-2.5 py-1 text-2xs text-on-surface-variant">
                More frameworks coming soon
              </span>
            </div>
          </div>

          {/* CTAs */}
          <div {...fadeUp(2)}>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/editor"
                className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
              >
                Try Now
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                href="/docs/getting-started"
                className="inline-flex items-center gap-2 rounded border border-outline-variant bg-transparent px-4 py-2.5 text-sm font-medium text-on-surface transition-colors hover:bg-surface-container"
              >
                Get Started
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center gap-2 rounded border border-outline-variant bg-transparent px-4 py-2.5 text-sm font-medium text-on-surface transition-colors hover:bg-surface-container"
              >
                View Docs
              </Link>
              <Link
                href="/playgrounds"
                className="inline-flex items-center gap-2 rounded border border-outline-variant bg-transparent px-4 py-2.5 text-sm font-medium text-on-surface transition-colors hover:bg-surface-container"
              >
                <Play className="h-3.5 w-3.5" />
                Open Playgrounds
              </Link>
            </div>
          </div>

          {/* Install command */}
          <div {...fadeUp(3)}>
            <div className="mt-6">
              <InstallCommand />
            </div>
          </div>

          {/* Technical stats */}
          <div {...fadeUp(4)}>
            <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3">
              {[
                { label: 'Time model', value: 'Integer frames' },
                { label: 'Renderer', value: 'WebGL2 / OffscreenCanvas' },
                { label: 'Decode', value: 'WebCodecs + mediabunny' },
                { label: 'Audio', value: 'Web Audio API' },
              ].map((stat) => (
                <div key={stat.label}>
                  <div className="label-mono text-2xs text-on-surface-variant opacity-90">{stat.label}</div>
                  <div className="mt-0.5 font-mono text-xs text-on-surface">{stat.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Editor mockup */}
        <div {...fadeUp(5)}>
          <div className="mt-16">
            <EditorMockup />
          </div>
        </div>
      </div>
    </section>
  )
}

function EditorMockup() {
  return (
    <div className="overflow-hidden rounded-lg border border-outline-variant bg-[#0a0a0a] shadow-elevated">
      {/* Window chrome */}
      <div className="flex h-9 items-center gap-1.5 border-b border-white/10 px-4">
        <div className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
        <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/80" />
        <div className="h-2.5 w-2.5 rounded-full bg-green-500/80" />
        <div className="ml-3 h-5 flex-1 rounded border border-white/10 bg-white/5 px-2 flex items-center">
          <span className="font-mono text-2xs text-white/60">elah · Full Editor</span>
        </div>
      </div>

      {/* Editor layout */}
      <div className="flex" style={{ height: '320px' }}>
        {/* Asset panel */}
        <div className="w-44 shrink-0 border-r border-white/10 bg-[#0a0a0a] p-3">
          <div className="label-mono mb-2 text-2xs text-white/60">MEDIA LIBRARY</div>
          {['intro.mp4', 'bg-music.mp3', 'logo.png', 'title.txt'].map((file, i) => (
            <div
              key={file}
              className="mb-1 flex items-center gap-2 rounded px-2 py-1.5 text-xs text-white/60 hover:bg-white/5"
            >
              <div
                className={`h-1.5 w-1.5 rounded-full ${
                  i === 0 ? 'bg-blue-400' : i === 1 ? 'bg-green-400' : i === 2 ? 'bg-purple-400' : 'bg-yellow-400'
                }`}
              />
              {file}
            </div>
          ))}
        </div>

        {/* Preview */}
        <div className="relative flex flex-1 items-center justify-center bg-[#050505]">
          <div className="relative aspect-video w-2/3 overflow-hidden rounded border border-white/10 bg-[#111]">
            {/* Fake filmstrip overlay */}
            <div className="absolute bottom-0 left-0 right-0 flex h-6 items-center gap-1 bg-black/60 px-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-4 flex-1 rounded-sm bg-white/10" />
              ))}
            </div>
          </div>
          {/* Timecode */}
          <div className="absolute bottom-3 right-4 font-mono text-xs text-white/60">00:00:02:15</div>
        </div>
      </div>

      {/* Timeline */}
      <div className="border-t border-white/10 bg-[#0a0a0a] p-3" style={{ height: '100px' }}>
        {/* Ruler */}
        <div className="mb-2 flex items-center border-b border-white/10 pb-1">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex-1 border-l border-white/10 pl-1">
              <span className="font-mono text-2xs text-white/50">{i * 5}s</span>
            </div>
          ))}
        </div>
        {/* Tracks */}
        {[
          { label: 'VIDEO', color: '#1a5f38', clips: [{ start: 0, width: 25 }, { start: 30, width: 35 }] },
          { label: 'AUDIO', color: '#4a3f2f', clips: [{ start: 5, width: 60 }] },
          { label: 'TEXT', color: '#3a2a4a', clips: [{ start: 10, width: 15 }, { start: 50, width: 20 }] },
        ].map((track) => (
          <div key={track.label} className="mb-1 flex items-center gap-2">
            <div className="label-mono w-10 text-right text-2xs text-white/60">{track.label}</div>
            <div className="relative flex-1 rounded" style={{ height: '18px', background: '#111' }}>
              {track.clips.map((clip, i) => (
                <div
                  key={i}
                  className="absolute inset-y-0.5 rounded-sm"
                  style={{
                    left: `${clip.start}%`,
                    width: `${clip.width}%`,
                    backgroundColor: track.color,
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                />
              ))}
              {/* Playhead */}
              <div
                className="absolute inset-y-0 w-px bg-red-500/80"
                style={{ left: '20%' }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
