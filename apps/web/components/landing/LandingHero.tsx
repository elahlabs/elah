'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import posthog from 'posthog-js'
import { Icon } from './Icon'
import { EditorMockup } from './EditorMockup'
import { EDITOR_URL, INSTALL_COMMAND } from './landingData'

const riseBase = 'lv-rise .8s cubic-bezier(.2,.7,.2,1)'

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
          padding: 'clamp(56px, 9vw, 96px) 24px 0',
          position: 'relative',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 28,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-geist-mono)',
            fontSize: 11,
            letterSpacing: '.16em',
            color: 'var(--faint)',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            animation: `${riseBase} both`,
          }}
        >
          <span>OPEN SOURCE · APACHE-2.0</span>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--accent)' }} />
          <span style={{ color: 'var(--accent)' }}>WEBCODECS + WEBGL2</span>
        </div>

        <h1
          style={{
            fontFamily: 'var(--font-display)',
            animation: `${riseBase} both`,
            fontSize: 'clamp(36px, 7.4vw, 86px)',
            lineHeight: 1.06,
            letterSpacing: '-0.03em',
            fontWeight: 600,
            margin: 0,
            maxWidth: 900,
            textWrap: 'balance',
          }}
        >
          Browser-native
          <br />
          <span
            style={{
              background: 'linear-gradient(100deg, var(--accent), #4d8dff 80%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            video infrastructure
          </span>
        </h1>

        <p
          style={{
            animation: `${riseBase} .1s both`,
            fontSize: 'clamp(15px, 2vw, 17.5px)',
            lineHeight: 1.65,
            color: 'var(--muted)',
            maxWidth: 620,
            padding: '0 8px',
            margin: 0,
            textWrap: 'pretty',
          }}
        >
          The timeline, rendering, and editing foundation for professional creative applications built
          entirely on the web. Engine-first, renderer-agnostic, scalable from prototype to production — in
          the browser and on your server.
        </p>

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
          <Link
            href={EDITOR_URL}
            className="lv-accent-btn"
            style={{
              background: 'var(--accent)',
              color: 'var(--ink)',
              fontWeight: 600,
              fontSize: 'clamp(13px, 1.6vw, 14px)',
              padding: '10px 18px',
              borderRadius: 9,
              boxShadow: '0 0 20px color-mix(in oklab, var(--accent) 32%, transparent)',
            }}
          >
            Try the Editor
          </Link>
          <a
            href="#playgrounds"
            className="lv-outline"
            style={{
              border: '1px solid var(--line)',
              background: 'var(--card)',
              color: 'var(--text)',
              fontWeight: 500,
              fontSize: 'clamp(13px, 1.6vw, 14px)',
              padding: '10px 18px',
              borderRadius: 9,
            }}
          >
            Open Playgrounds
          </a>
          <button
            onClick={copyCmd}
            title="Copy install command"
            className="lv-copy"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontFamily: 'var(--font-geist-mono)',
              fontSize: 'clamp(11.5px, 1.5vw, 13px)',
              color: 'var(--muted)',
              background: 'var(--card)',
              border: '1px solid var(--line)',
              borderRadius: 9,
              padding: '10px 14px',
              cursor: 'pointer',
            }}
          >
            <span style={{ color: 'var(--accent)' }}>$</span> npm install @elah/editor
            <Icon name={copied ? 'check' : 'content_copy'} size={15} color="var(--faint)" />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12.5,
            color: 'var(--faint)',
            flexWrap: 'wrap',
            justifyContent: 'center',
            animation: `${riseBase} .26s both`,
          }}
        >
          Framework-agnostic core
          {['Next.js', 'React'].map((f) => (
            <span
              key={f}
              style={{
                background: 'color-mix(in oklab, var(--accent) 10%, transparent)',
                color: 'var(--accent)',
                borderRadius: 99,
                padding: '3px 11px',
                fontWeight: 500,
              }}
            >
              {f}
            </span>
          ))}
          <span style={{ border: '1px dashed var(--line)', color: 'var(--muted)', borderRadius: 99, padding: '3px 11px' }}>
            React Native · experimental
          </span>
          more coming soon
        </div>
      </div>

      <EditorMockup />
    </header>
  )
}
