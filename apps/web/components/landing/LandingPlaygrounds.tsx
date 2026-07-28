'use client'

import Link from 'next/link'
import posthog from 'posthog-js'
import { Icon } from './Icon'
import { CardHeader, type CardHeaderKind } from './CardHeader'
import { playgrounds, type PlaygroundEntry } from './landingData'

const headerKindByVariant: Record<PlaygroundEntry['variant'], CardHeaderKind> = {
  full: 'editor',
  timeline: 'timeline',
  demo: 'demo',
}

export function LandingPlaygrounds() {
  return (
    <section id="playgrounds" style={{ borderTop: '1px solid var(--line2)', scrollMarginTop: 60 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(60px, 9vw, 100px) 24px' }}>
        <div style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11, letterSpacing: '.16em', color: 'var(--accent)' }}>
          03 — INTERACTIVE
        </div>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(25px, 4.6vw, 40px)',
            letterSpacing: '-0.02em',
            fontWeight: 600,
            margin: '14px 0 8px',
          }}
        >
          Launch a playground.
        </h2>
        <p style={{ color: 'var(--muted)', fontSize: 16, maxWidth: 540, margin: '0 0 44px', lineHeight: 1.6 }}>
          Explore the editor live. Each playground is a fully functional deployment of the SDK.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px,1fr))', gap: 18 }}>
          {playgrounds.map((p) => (
            <div
              key={p.title}
              className="lv-pgcard"
              style={{
                border: '1px solid var(--line)',
                borderRadius: 12,
                background: 'var(--card)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                transition: 'border-color .18s, box-shadow .18s',
              }}
            >
              <CardHeader kind={headerKindByVariant[p.variant]} playheadPct={p.playhead} delay={p.delay} />
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                <span
                  style={{
                    alignSelf: 'flex-start',
                    fontFamily: 'var(--font-geist-mono)',
                    fontSize: 10.5,
                    borderRadius: 99,
                    padding: '2px 10px',
                    color: p.badgeColor,
                    border: '1px solid var(--line)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: p.badgeColor }} />
                  {p.badge}
                </span>
                <h3 style={{ fontSize: 17, margin: 0, fontWeight: 600 }}>{p.title}</h3>
                <p style={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.62, margin: 0, flex: 1, textWrap: 'pretty' }}>
                  {p.body}
                </p>
                <Link
                  href={p.href}
                  onClick={() =>
                    posthog.capture('playground_launched', {
                      title: p.title,
                      href: p.href,
                      variant: p.variant,
                      status: p.badge,
                    })
                  }
                  className="lv-launch"
                  style={{
                    marginTop: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    color: 'var(--accent)',
                    fontWeight: 600,
                    fontSize: 13.5,
                    transition: 'gap .18s',
                  }}
                >
                  Launch Playground
                  <Icon name="north_east" size={15} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
