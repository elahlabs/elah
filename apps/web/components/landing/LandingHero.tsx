'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import posthog from 'posthog-js'
import { Icon } from './Icon'
import { CardHeader } from './CardHeader'
import { EditorMockup } from './EditorMockup'
import { EDITOR_URL, GET_STARTED_URL, GITHUB_URL, libraries } from './landingData'
import { trackPlaygroundLaunch } from '@/lib/analytics'

const riseBase = 'lv-rise .8s cubic-bezier(.2,.7,.2,1)'

const outlineBtn = {
  border: '1px solid var(--line)',
  background: 'linear-gradient(180deg, color-mix(in oklab, var(--elev) 60%, var(--card)), var(--card))',
  color: 'var(--text)',
  fontWeight: 500,
  fontSize: 'clamp(13px, 1.6vw, 14px)',
  padding: '10px 20px',
  borderRadius: 999,
  boxShadow: 'inset 0 1px 0 color-mix(in oklab, white 6%, transparent)',
  transition: 'border-color .18s, transform .18s, box-shadow .18s, background .18s',
} as const

interface CommandLineProps {
  command: string
  copied: boolean
  onCopy: () => void
}

function CommandLine({ command, copied, onCopy }: CommandLineProps) {
  return (
    <div
      className="lv-copy"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: 'var(--font-geist-mono)',
        fontSize: 'clamp(10px, 1.5vw, 12.5px)',
        color: 'var(--muted)',
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        padding: '13px 12px 13px 16px',
      }}
    >
      <button
        onClick={onCopy}
        title={`Copy ${command}`}
        aria-label={`Copy ${command}`}
        style={{
          all: 'unset',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flex: 1,
          minWidth: 0,
          overflowX: 'auto',
          cursor: 'pointer',
        }}
      >
        <span style={{ color: 'var(--accent)' }}>$</span>
        <span style={{ whiteSpace: 'nowrap' }}>{command}</span>
        <Icon
          name={copied ? 'check' : 'content_copy'}
          size={16}
          color="var(--faint)"
          style={{ flexShrink: 0, marginLeft: 'auto' }}
        />
      </button>
    </div>
  )
}

export function LandingHero() {
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  function copyCmd(command: string, pkg: string) {
    try {
      navigator.clipboard.writeText(command)
    } catch {
      // clipboard may be unavailable (insecure context) — still flash feedback
    }
    posthog.capture('install_command_copied', { command, package: pkg })
    setCopiedCmd(command)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopiedCmd(null), 1400)
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
          padding: 'clamp(110px, 12vw, 146px) 24px 0',
          position: 'relative',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 24,
        }}
      >
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
          <Link href={GET_STARTED_URL} className="lv-outline lv-hero-btn" style={{ ...outlineBtn, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <Icon name="rocket_launch" size={15} color="var(--accent)" />
            Get Started
          </Link>
          <Link
            href={EDITOR_URL}
            className="lv-outline lv-hero-btn"
            style={{ ...outlineBtn, display: 'inline-flex', alignItems: 'center', gap: 7 }}
            onClick={() =>
              trackPlaygroundLaunch({
                source: 'hero_live_playground',
                title: 'Live Playground',
                href: EDITOR_URL,
                variant: 'full',
              })
            }
          >
            <Icon name="play_circle" size={15} color="var(--accent)" />
            Live Playground
          </Link>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="lv-outline lv-hero-btn" style={{ ...outlineBtn, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <Icon name="star" size={15} color="#f5c518" />
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

        {/* install commands — one per package, each independently copyable */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 14,
            width: '100%',
            animation: `${riseBase} .3s both`,
          }}
        >
          {libraries.map((lib) => {
            const installCmd = `npm install ${lib.pkg}`
            return (
              <div
                key={lib.pkg}
                className="lv-pgcard"
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 12,
                  background: 'var(--card)',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  textAlign: 'left',
                  transition: 'border-color .18s, box-shadow .18s',
                }}
              >
                <Link
                  href={lib.href}
                  aria-label={`Try ${lib.title}`}
                  style={{ display: 'block' }}
                  onClick={() =>
                    trackPlaygroundLaunch({ source: 'hero_library_card', title: lib.title, href: lib.href, variant: lib.variant })
                  }
                >
                  <CardHeader kind={lib.variant} />
                </Link>
                <div
                  style={{
                    padding: '10px 10px 0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{lib.title}</span>
                  <Link
                    href={lib.href}
                    className="lv-launch"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      color: 'var(--accent)',
                      fontWeight: 600,
                      fontSize: 11.5,
                      background: 'color-mix(in oklab, var(--bg) 55%, transparent)',
                      border: '1px solid var(--accent)',
                      borderRadius: 5,
                      padding: '3px 8px',
                      flexShrink: 0,
                      transition: 'gap .18s',
                    }}
                    onClick={() =>
                      trackPlaygroundLaunch({ source: 'hero_library_card', title: lib.title, href: lib.href, variant: lib.variant })
                    }
                  >
                    Try now
                    <Icon name="arrow_forward" size={12} />
                  </Link>
                </div>
                <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <CommandLine
                    command={installCmd}
                    copied={copiedCmd === installCmd}
                    onCopy={() => copyCmd(installCmd, lib.pkg)}
                  />
                  {lib.extraCmd && (
                    <CommandLine
                      command={lib.extraCmd}
                      copied={copiedCmd === lib.extraCmd}
                      onCopy={() => copyCmd(lib.extraCmd as string, lib.pkg)}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* scroll hint */}
        <a
          href="#libraries"
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
