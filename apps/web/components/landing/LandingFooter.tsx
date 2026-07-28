import Link from 'next/link'
import { footerColumns } from './landingData'

const isExternal = (href: string) => href.startsWith('http')

export function LandingFooter() {
  return (
    <footer style={{ borderTop: '1px solid var(--line2)', background: 'var(--bg2)' }}>
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '56px 28px 36px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px,1fr))',
          gap: '40px 28px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--text)', fontWeight: 700, fontSize: 15 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: 'var(--accent)',
                boxShadow: '0 0 8px color-mix(in oklab, var(--accent) 55%, transparent)',
              }}
            />
            elah
          </Link>
          <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6, margin: 0, maxWidth: 280 }}>
            Browser-native video infrastructure. Engine-first, renderer-agnostic, built for production
            creative tooling.
          </p>
          <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11, color: 'var(--faint)' }}>
            WebCodecs · WebGL2 · React
          </span>
        </div>

        {footerColumns.map((col) => (
          <div key={col.heading} style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13.5 }}>
            <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 10, letterSpacing: '.14em', color: 'var(--faint)' }}>
              {col.heading}
            </span>
            {col.links.map((l) =>
              isExternal(l.href) ? (
                <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className="lv-footlink" style={{ color: 'var(--muted)' }}>
                  {l.label}
                </a>
              ) : (
                <Link key={l.label} href={l.href} className="lv-footlink" style={{ color: 'var(--muted)' }}>
                  {l.label}
                </Link>
              ),
            )}
          </div>
        ))}
      </div>
      <div style={{ borderTop: '1px solid var(--line2)' }}>
        <div
          style={{
            maxWidth: 1200,
            margin: '0 auto',
            padding: '18px 28px',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 12,
            color: 'var(--faint)',
            flexWrap: 'wrap',
            gap: '6px 20px',
          }}
        >
          <span>© 2026 Elah Labs Private Limited. Open source under the Apache-2.0 license.</span>
          <span>Built with Next.js · Deployed on Vercel</span>
        </div>
      </div>
    </footer>
  )
}
