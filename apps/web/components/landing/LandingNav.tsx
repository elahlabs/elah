'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTheme } from '@/components/ThemeProvider'
import { Icon } from './Icon'
import { navLinks, GITHUB_URL, GET_STARTED_URL } from './landingData'

const linkStyle = { color: 'var(--muted)', padding: '6px 11px', borderRadius: 7 } as const

export function LandingNav() {
  const { theme, toggle } = useTheme()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <nav
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        background: 'var(--nav)',
        borderBottom: '1px solid var(--line2)',
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '6px 28px',
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          gap: '14px 20px',
          flexWrap: 'wrap',
        }}
      >
        <Link
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            color: 'var(--text)',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 17,
            letterSpacing: '-0.02em',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--accent)',
              boxShadow: '0 0 10px color-mix(in oklab, var(--accent) 60%, transparent)',
            }}
          />
          elah
        </Link>

        <span data-lv-mobile style={{ flex: 1 }} />

        <div data-lv-desktop style={{ display: 'flex', gap: 2, fontSize: 13.5, flex: 1, flexWrap: 'wrap' }}>
          {navLinks.map((l) =>
            l.href.startsWith('#') ? (
              <a key={l.label} href={l.href} className="lv-navlink" style={linkStyle}>
                {l.label}
              </a>
            ) : (
              <Link key={l.label} href={l.href} className="lv-navlink" style={linkStyle}>
                {l.label}
              </Link>
            ),
          )}
        </div>

        <Link
          data-lv-desktop
          href="/changelog"
          className="lv-pill"
          style={{
            fontFamily: 'var(--font-geist-mono)',
            fontSize: 11.5,
            color: 'var(--muted)',
            border: '1px solid var(--line)',
            borderRadius: 99,
            padding: '4px 11px',
          }}
        >
          <span style={{ color: 'var(--accent)' }}>v0.3.1</span> · What&apos;s new
        </Link>

        <a
          data-lv-desktop
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="lv-ghost"
          style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}
        >
          GitHub
        </a>

        <button
          onClick={toggle}
          title="Toggle theme"
          aria-label="Toggle theme"
          className="lv-icon-btn"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: '1px solid var(--line)',
            background: 'transparent',
            color: 'var(--muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} size={17} />
        </button>

        <Link
          href={GET_STARTED_URL}
          className="lv-accent-btn"
          style={{
            background: 'var(--accent)',
            color: 'var(--ink)',
            fontWeight: 600,
            fontSize: 13.5,
            padding: '8px 15px',
            borderRadius: 8,
            boxShadow: '0 0 14px color-mix(in oklab, var(--accent) 30%, transparent)',
          }}
        >
          Get Started
        </Link>

        <button
          data-lv-mobile
          onClick={() => setMenuOpen((v) => !v)}
          title="Menu"
          aria-label="Toggle menu"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: '1px solid var(--line)',
            background: 'transparent',
            color: 'var(--muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          <Icon name={menuOpen ? 'close' : 'menu'} size={18} />
        </button>
      </div>

      {menuOpen && (
        <div
          data-lv-mobile
          style={{
            borderTop: '1px solid var(--line2)',
            padding: '8px 22px 14px',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--nav)',
          }}
        >
          {navLinks.map((l) => {
            const style = {
              color: 'var(--text)',
              fontSize: 15,
              padding: '11px 2px',
              borderBottom: '1px solid var(--line2)',
            } as const
            return l.href.startsWith('#') ? (
              <a key={l.label} href={l.href} onClick={() => setMenuOpen(false)} style={style}>
                {l.label}
              </a>
            ) : (
              <Link key={l.label} href={l.href} onClick={() => setMenuOpen(false)} style={style}>
                {l.label}
              </Link>
            )
          })}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMenuOpen(false)}
            style={{ color: 'var(--muted)', fontSize: 13, padding: '12px 2px 2px', fontFamily: 'var(--font-geist-mono)' }}
          >
            <span style={{ color: 'var(--accent)' }}>v0.3.1</span> · What&apos;s new — GitHub ↗
          </a>
        </div>
      )}
    </nav>
  )
}
