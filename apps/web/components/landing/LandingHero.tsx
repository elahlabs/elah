'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import posthog from 'posthog-js'
import { Icon } from './Icon'
import { EditorMockup } from './EditorMockup'
import { EDITOR_URL, INSTALL_COMMAND, GET_STARTED_URL, GITHUB_URL } from './landingData'

const riseBase = 'lv-rise .8s cubic-bezier(.2,.7,.2,1)'

const outlineBtn = {
  border: '1px solid var(--line)',
  background: 'var(--card)',
  color: 'var(--text)',
  fontWeight: 500,
  fontSize: 'clamp(13px, 1.6vw, 14px)',
  padding: '10px 20px',
  borderRadius: 9,
} as const

export function LandingHero() {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  function copyCmd() {
    try {
      navigator.clipboard.writeText(INSTALL_COMMAND)
    } catch {
      // clipboard may be unavailable (insecure context) — still flash feedback
    }
    posthog.capture('install_command_copied', { command: INSTALL_COMMAND })
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1400)
  }

  return (
    <header
      style={{
        position: 'relative',
        overflow: 'hidden',
        backgroundImage:
          'linear-gradient(color-mix(in oklab, var(--line) 36%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--line) 36%, transparent) 1px, transparent 1px)',
        backgroundSize: '72px 72px',
        backgroundPosition: 'center top',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(1000px 480px at 50% -120px, color-mix(in oklab, var(--accent) 13%, transparent), transparent 70%), linear-gradient(180deg, transparent 40%, var(--bg) 96%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: 'clamp(48px, 8vw, 84px) 24px 0',
          position: 'relative',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 24,
        }}
      >
        {/* wordmark */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 22,
            letterSpacing: '-0.02em',
            color: 'var(--text)',
            animation: `${riseBase} both`,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: 'var(--accent)',
              boxShadow: '0 0 12px color-mix(in oklab, var(--accent) 60%, transparent)',
            }}
          />
          elah
        </div>

        <h1
          style={{
            fontFamily: 'var(--font-display)',
            animation: `${riseBase} .06s both`,
            fontSize: 'clamp(34px, 6.6vw, 74px)',
            lineHeight: 1.07,
            letterSpacing: '-0.03em',
            fontWeight: 600,
            margin: 0,
            maxWidth: 900,
            textWrap: 'balance',
          }}
        >
          Build{' '}
          <span
            style={{
              background: 'linear-gradient(100deg, var(--accent), #4d8dff 80%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            AI Media Applications.
          </span>
        </h1>

        <p
          style={{
            animation: `${riseBase} .1s both`,
            fontSize: 'clamp(15px, 2vw, 17.5px)',
            lineHeight: 1.65,
            color: 'var(--muted)',
            maxWidth: 640,
            padding: '0 8px',
            margin: 0,
            textWrap: 'pretty',
          }}
        >
          Build video generation, audio editing, podcast software, browser-native editors, rendering, and
          media workflows with open-source infrastructure.
        </p>

        {/* subtle outline actions */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            flexWrap: 'wrap',
            justifyContent: 'center',
            animation: `${riseBase} .18s both`,
          }}
        >
          <Link href={GET_STARTED_URL} className="lv-outline" style={outlineBtn}>
            Get Started
          </Link>
          <Link href={EDITOR_URL} className="lv-outline" style={outlineBtn}>
            Live Playground
          </Link>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="lv-outline" style={{ ...outlineBtn, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <Icon name="star" size={15} color="var(--accent)" />
            GitHub
          </a>
        </div>

        {/* trust badges */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px 20px',
            fontSize: 12.5,
            color: 'var(--faint)',
            flexWrap: 'wrap',
            justifyContent: 'center',
            fontFamily: 'var(--font-geist-mono)',
            animation: `${riseBase} .24s both`,
          }}
        >
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="lv-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--muted)' }}>
            <span aria-hidden>⭐</span> Star us on GitHub
          </a>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden>📦</span> 4 Open Source Libraries
          </span>
          <span
            style={{
              border: '1px solid var(--line)',
              borderRadius: 99,
              padding: '3px 11px',
              color: 'var(--muted)',
            }}
          >
            Apache 2.0
          </span>
        </div>

        {/* install command */}
        <button
          onClick={copyCmd}
          title="Copy install command"
          className="lv-copy"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            width: '100%',
            maxWidth: 720,
            justifyContent: 'space-between',
            fontFamily: 'var(--font-geist-mono)',
            fontSize: 'clamp(10px, 1.5vw, 12.5px)',
            color: 'var(--muted)',
            background: 'var(--card)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            padding: '13px 16px',
            cursor: 'pointer',
            animation: `${riseBase} .3s both`,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, overflowX: 'auto' }}>
            <span style={{ color: 'var(--accent)' }}>$</span>
            <span style={{ whiteSpace: 'nowrap' }}>{INSTALL_COMMAND}</span>
          </span>
          <Icon name={copied ? 'check' : 'content_copy'} size={16} color="var(--faint)" />
        </button>

        {/* scroll hint */}
        <a
          href="#playgrounds"
          className="lv-ghost"
          style={{
            fontFamily: 'var(--font-geist-mono)',
            fontSize: 12,
            letterSpacing: '.1em',
            color: 'var(--faint)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            animation: `${riseBase} .36s both`,
          }}
        >
          ↓ Explore Libraries &amp; Playground ↓
        </a>
      </div>

      <EditorMockup />
    </header>
  )
}
