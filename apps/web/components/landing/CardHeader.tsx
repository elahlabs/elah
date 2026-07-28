import type { CSSProperties } from 'react'

export type CardHeaderKind = 'editor' | 'timeline' | 'headless' | 'core' | 'demo'

export interface CardHeaderProps {
  kind: CardHeaderKind
  /** Only used by the 'timeline' kind — lets sibling cards desync their sweep. */
  playheadPct?: string
  delay?: string
}

const headerBase: CSSProperties = {
  height: 110,
  background: 'linear-gradient(160deg, #0a0d14, #121a2e)',
  borderBottom: '1px solid var(--line2)',
  position: 'relative',
}

export function CardHeader({ kind, playheadPct = '48%', delay = '-3s' }: CardHeaderProps) {
  if (kind === 'editor') {
    return (
      <div style={{ ...headerBase, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div
          style={{
            flex: 1,
            borderRadius: 6,
            border: '1px solid #223055',
            background: 'linear-gradient(160deg, rgba(59,130,246,.14), rgba(29,78,216,.05))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'lv-glowPulse 5s ease-in-out infinite',
          }}
        >
          <span
            style={{
              width: 0,
              height: 0,
              borderTop: '6px solid transparent',
              borderBottom: '6px solid transparent',
              borderLeft: '9px solid #60a5fa',
              opacity: 0.85,
            }}
          />
        </div>
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ display: 'block', height: 6, borderRadius: 2, width: '70%', background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)' }} />
          <span style={{ display: 'block', height: 6, borderRadius: 2, width: '46%', marginLeft: '16%', background: '#0c2a26', border: '1px solid #0d4d3c' }} />
          <span
            style={{
              position: 'absolute',
              top: -4,
              bottom: -4,
              left: '30%',
              width: 1.5,
              background: '#fff',
              opacity: 0.8,
              animation: 'lv-phSweepPct 9s linear infinite alternate',
            }}
          />
        </div>
      </div>
    )
  }

  if (kind === 'timeline') {
    return (
      <div style={{ ...headerBase, padding: 16, display: 'flex', flexDirection: 'column', gap: 7, justifyContent: 'center' }}>
        <span style={{ display: 'block', height: 8, borderRadius: 3, width: '62%', background: 'linear-gradient(180deg,#3b82f6,#1d4ed8)' }} />
        <span style={{ display: 'block', height: 8, borderRadius: 3, width: '40%', marginLeft: '14%', background: '#7a2e10', border: '1px solid #ad5621' }} />
        <span style={{ display: 'block', height: 8, borderRadius: 3, width: '76%', background: '#0c2a26', border: '1px solid #0d4d3c' }} />
        <span
          style={{
            position: 'absolute',
            top: 16,
            bottom: 16,
            left: playheadPct,
            width: 1.5,
            background: '#fff',
            opacity: 0.8,
            animation: 'lv-phSweepPct 9s linear infinite alternate',
            animationDelay: delay,
          }}
        />
      </div>
    )
  }

  if (kind === 'headless') {
    return (
      <div style={{ ...headerBase, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'var(--font-geist-mono)', fontSize: 11.5 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ad5621' }} />
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#7a5a10' }} />
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#0d4d3c' }} />
        </div>
        <div style={{ color: '#7fd0a8', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>
            <span style={{ color: '#4c8bf5' }}>$</span> elah render spec.json
            <span
              style={{
                display: 'inline-block',
                width: 6,
                height: 12,
                marginLeft: 4,
                background: '#7fd0a8',
                verticalAlign: '-2px',
                animation: 'lv-cursorBlink 1s step-end infinite',
              }}
            />
          </span>
          <span style={{ animation: 'lv-cliLine 3.6s ease-in-out infinite', animationDelay: '.4s', opacity: 0 }}>
            ✓ frame 128/128 rendered
          </span>
          <span style={{ animation: 'lv-cliLine 3.6s ease-in-out infinite', animationDelay: '1.2s', opacity: 0, color: '#e0b33c' }}>
            → POST /render 200 OK
          </span>
        </div>
      </div>
    )
  }

  if (kind === 'demo') {
    const steps = [
      { label: 'Cut', delay: '0s' },
      { label: 'Trim', delay: '.9s' },
      { label: 'Text', delay: '1.8s' },
      { label: 'Export', delay: '2.7s' },
    ]
    return (
      <div style={{ ...headerBase, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 }}>
        {steps.map((step, i) => (
          <span key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontFamily: 'var(--font-geist-mono)',
                fontSize: 10.5,
                color: 'var(--muted)',
                border: '1px solid var(--line)',
                borderRadius: 99,
                padding: '3px 9px',
                background: 'var(--card)',
                animation: 'lv-tagCycle 3.6s ease-in-out infinite',
                animationDelay: step.delay,
              }}
            >
              {step.label}
            </span>
            {i < steps.length - 1 && <span style={{ width: 10, height: 1, background: 'var(--line2)' }} />}
          </span>
        ))}
      </div>
    )
  }

  return (
    <div style={{ ...headerBase, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span
        style={{
          fontFamily: 'var(--font-geist-mono)',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--accent)',
          border: '1px solid var(--line)',
          borderRadius: 99,
          padding: '4px 12px',
          background: 'rgba(0,194,255,.06)',
          zIndex: 1,
        }}
      >
        core
      </span>
      {[
        { label: 'react', top: '14%', left: '10%', delay: '0s' },
        { label: 'vue', top: '14%', left: '68%', delay: '.9s' },
        { label: 'node', top: '68%', left: '8%', delay: '1.8s' },
        { label: 'vanilla', top: '68%', left: '64%', delay: '2.7s' },
      ].map((tag) => (
        <span
          key={tag.label}
          style={{
            position: 'absolute',
            top: tag.top,
            left: tag.left,
            fontFamily: 'var(--font-geist-mono)',
            fontSize: 10,
            color: 'var(--muted)',
            border: '1px solid var(--line)',
            borderRadius: 99,
            padding: '2px 8px',
            background: 'var(--card)',
            animation: 'lv-tagCycle 3.6s ease-in-out infinite',
            animationDelay: tag.delay,
          }}
        >
          {tag.label}
        </span>
      ))}
    </div>
  )
}
