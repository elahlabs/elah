import Link from 'next/link'
import { Icon } from './Icon'
import { libraries } from './landingData'

export function LandingLibraries() {
  return (
    <section id="libraries" style={{ borderTop: '1px solid var(--line2)', scrollMarginTop: 60 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(60px, 9vw, 100px) 24px' }}>
        <div style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11, letterSpacing: '.16em', color: 'var(--accent)' }}>
          OPEN SOURCE LIBRARIES
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
          Choose a library.
        </h2>
        <p style={{ color: 'var(--muted)', fontSize: 16, maxWidth: 540, margin: '0 0 44px', lineHeight: 1.6 }}>
          Four composable packages. Drop in the whole editor, or take only the layer you need.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px,1fr))', gap: 18 }}>
          {libraries.map((lib) => (
            <div
              key={lib.pkg}
              className="lv-pgcard"
              style={{
                border: '1px solid var(--line)',
                borderRadius: 12,
                background: 'var(--card)',
                padding: 22,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                transition: 'border-color .18s, box-shadow .18s',
              }}
            >
              <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                {lib.pkg}
              </span>
              <h3 style={{ fontSize: 16, margin: 0, fontWeight: 600, letterSpacing: '-0.015em' }}>{lib.title}</h3>
              <p style={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.62, margin: 0, flex: 1, textWrap: 'pretty' }}>
                {lib.subtitle}
              </p>
              <Link
                href={lib.href}
                className="lv-launch"
                style={{
                  marginTop: 4,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  color: 'var(--accent)',
                  fontWeight: 600,
                  fontSize: 13.5,
                  transition: 'gap .18s',
                }}
              >
                Try
                <Icon name="arrow_forward" size={15} />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
