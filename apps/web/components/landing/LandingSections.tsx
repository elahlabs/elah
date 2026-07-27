import type { CSSProperties } from 'react'
import { features, flow, integrationPoints, faq, GITHUB_URL, GET_STARTED_URL } from './landingData'

// Scroll-driven reveal, matching the design. Where animation-timeline is
// unsupported the keyframe simply runs once on mount — still a graceful entrance.
const reveal = (range = 'entry 0% entry 30%'): CSSProperties => ({
  animation: 'lv-rise .7s cubic-bezier(.2,.7,.2,1) both',
  animationTimeline: 'view()',
  animationRange: range,
})

const eyebrow: CSSProperties = {
  fontFamily: 'var(--font-geist-mono)',
  fontSize: 11,
  letterSpacing: '.16em',
  color: 'var(--accent)',
}

const heading: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'clamp(25px, 4.6vw, 40px)',
  letterSpacing: '-0.02em',
  fontWeight: 600,
}

const sectionPad = 'clamp(60px, 9vw, 100px) 24px'

export function SpecStrip() {
  const specs = [
    ['TIME MODEL', 'Integer frames'],
    ['RENDERER', 'WebGL2 / OffscreenCanvas'],
    ['DECODE', 'WebCodecs + mediabunny'],
    ['AUDIO', 'Web Audio API'],
  ]
  return (
    <section style={{ borderTop: '1px solid var(--line2)', borderBottom: '1px solid var(--line2)' }}>
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '0 28px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(215px,1fr))',
          ...reveal('entry 0% entry 40%'),
        }}
      >
        {specs.map(([label, value], i) => (
          <div
            key={label}
            style={{
              padding: i === 0 ? '22px 24px 22px 0' : i === specs.length - 1 ? '22px 0 22px 24px' : '22px 24px',
              borderRight: i === specs.length - 1 ? undefined : '1px solid var(--line2)',
            }}
          >
            <div style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 10, letterSpacing: '.14em', color: 'var(--faint)' }}>
              {label}
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 6 }}>{value}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function Architecture() {
  return (
    <section style={{ background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: sectionPad }}>
        <div style={eyebrow}>01 — ARCHITECTURE</div>
        <h2 style={{ ...heading, margin: '14px 0 8px', ...reveal() }}>Built for precision.</h2>
        <p style={{ color: 'var(--muted)', fontSize: 16, maxWidth: 540, margin: '0 0 44px', lineHeight: 1.6 }}>
          Every layer of the stack is designed around one principle: determinism. Same input, same output,
          every time.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px,1fr))',
            gap: 1,
            background: 'var(--line2)',
            border: '1px solid var(--line2)',
          }}
        >
          {features.map((f) => (
            <div
              key={f.idx}
              className="lv-feature"
              style={{
                background: 'var(--bg)',
                padding: 26,
                display: 'flex',
                flexDirection: 'column',
                gap: 11,
                ...reveal('entry 0% entry 35%'),
              }}
            >
              <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 10.5, color: 'var(--faint)' }}>{f.idx}</span>
              <h3 style={{ fontSize: 16, margin: 0, fontWeight: 600, letterSpacing: '-0.015em' }}>{f.title}</h3>
              <p style={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.62, margin: 0, flex: 1, textWrap: 'pretty' }}>
                {f.body}
              </p>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {f.tags.map((t) => (
                  <span
                    key={t}
                    style={{
                      fontFamily: 'var(--font-geist-mono)',
                      fontSize: 10.5,
                      color: 'var(--accent)',
                      background: 'color-mix(in oklab, var(--accent) 9%, transparent)',
                      borderRadius: 5,
                      padding: '2px 8px',
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function DataFlow() {
  return (
    <section style={{ borderTop: '1px solid var(--line2)', background: 'var(--bg2)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: sectionPad, textAlign: 'center' }}>
        <div style={eyebrow}>02 — DATA FLOW</div>
        <h2 style={{ ...heading, margin: '14px 0 44px', textWrap: 'balance', ...reveal() }}>
          One mutation funnel.
          <br />
          One pure resolver.
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
          {flow.map((layer, i) => (
            <div key={layer.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {i > 0 && (
                <span
                  style={{
                    position: 'relative',
                    width: 1,
                    height: 24,
                    background: 'linear-gradient(180deg, var(--line), var(--accent))',
                    display: 'block',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      top: -4,
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: 'var(--accent)',
                      boxShadow: '0 0 8px var(--accent)',
                      animation: 'lv-flowDot 2.6s ease-in-out infinite',
                    }}
                  />
                </span>
              )}
              <div
                style={{
                  width: '100%',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  background: 'var(--card)',
                  padding: '14px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px 16px',
                  textAlign: 'left',
                  flexWrap: 'wrap',
                  ...reveal('entry 0% entry 35%'),
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-geist-mono)',
                    fontSize: 10,
                    letterSpacing: '.12em',
                    color: 'var(--accent)',
                    width: 118,
                    flexShrink: 0,
                  }}
                >
                  {layer.name}
                </span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {layer.items.map((it) => (
                    <span
                      key={it}
                      style={{
                        fontFamily: 'var(--font-geist-mono)',
                        fontSize: 11.5,
                        color: 'var(--text)',
                        border: '1px solid var(--line)',
                        borderRadius: 6,
                        padding: '4px 10px',
                        background: 'var(--bg)',
                      }}
                    >
                      {it}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function Integration() {
  return (
    <section style={{ borderTop: '1px solid var(--line2)', background: 'var(--bg2)' }}>
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: sectionPad,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px,100%),1fr))',
          gap: 48,
          alignItems: 'center',
        }}
      >
        <div>
          <div style={eyebrow}>04 — INTEGRATION</div>
          <h2 style={{ ...heading, margin: '14px 0 12px', ...reveal() }}>Drop in. Wire. Ship.</h2>
          <p style={{ color: 'var(--muted)', fontSize: 15.5, lineHeight: 1.65, margin: '0 0 26px', textWrap: 'pretty' }}>
            The full editor composes in fewer than 20 lines. Bring your own demuxer factory and the preview
            handles decode, render, playback, and audio automatically.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, ...reveal() }}>
            {integrationPoints.map((pt) => (
              <div key={pt.code} style={{ display: 'flex', gap: 12, alignItems: 'baseline', fontSize: 14, color: 'var(--muted)' }}>
                <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-geist-mono)', fontSize: 12 }}>→</span>
                <span>
                  <span style={{ color: 'var(--text)', fontWeight: 600, fontFamily: 'var(--font-geist-mono)', fontSize: 13 }}>
                    {pt.code}
                  </span>{' '}
                  {pt.rest}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            border: '1px solid #232938',
            borderRadius: 12,
            background: '#0a0d14',
            boxShadow: '0 30px 80px rgba(0,0,0,.4)',
            overflow: 'hidden',
            ...reveal(),
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 18px',
              borderBottom: '1px solid #1a1f2b',
              fontFamily: 'var(--font-geist-mono)',
              fontSize: 11.5,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#c9d8f5' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#00c2ff' }} />
              App.tsx
            </span>
            <span style={{ color: '#7a858b' }}>@elah/editor</span>
          </div>
          <pre style={{ margin: 0, padding: '20px 22px', fontFamily: 'var(--font-geist-mono)', fontSize: 12, lineHeight: 1.75, color: '#c9d8f5', overflowX: 'auto' }}>
            <span style={{ color: '#7fb2ff' }}>import</span> {'{'}
            {'\n  EditorProvider,\n  AssetPanel,\n  Preview,\n  Timeline,\n  createDefaultDemuxerFactory,\n'}
            {'}'} <span style={{ color: '#7fb2ff' }}>from</span> <span style={{ color: '#8ce0b0' }}>&apos;@elah/editor&apos;</span>
            {'\n\n'}
            <span style={{ color: '#7fb2ff' }}>const</span> demuxerFactory = <span style={{ color: '#e8c57c' }}>createDefaultDemuxerFactory</span>()
            {'\n\n'}
            <span style={{ color: '#7fb2ff' }}>export default function</span> <span style={{ color: '#e8c57c' }}>App</span>() {'{'}
            {'\n  '}
            <span style={{ color: '#7fb2ff' }}>return</span> (
            {'\n    <'}
            <span style={{ color: '#6fe0d2' }}>EditorProvider</span> fps={'{'}<span style={{ color: '#e8a0c0' }}>30</span>{'}'}&gt;
            {'\n      <'}
            <span style={{ color: '#6fe0d2' }}>div</span> style={'{{'} display: <span style={{ color: '#8ce0b0' }}>&apos;flex&apos;</span>, height: <span style={{ color: '#8ce0b0' }}>&apos;100vh&apos;</span>,
            {'\n                    '}flexDirection: <span style={{ color: '#8ce0b0' }}>&apos;column&apos;</span> {'}}'}&gt;
            {'\n        <'}
            <span style={{ color: '#6fe0d2' }}>div</span> style={'{{'} display: <span style={{ color: '#8ce0b0' }}>&apos;flex&apos;</span>, flex: <span style={{ color: '#e8a0c0' }}>1</span> {'}}'}&gt;
            {'\n          <'}
            <span style={{ color: '#6fe0d2' }}>AssetPanel</span> style={'{{'} width: <span style={{ color: '#e8a0c0' }}>240</span> {'}}'} /&gt;
            {'\n          <'}
            <span style={{ color: '#6fe0d2' }}>Preview</span>
            {'\n            '}demuxerFactory={'{'}demuxerFactory{'}'}
            {'\n            '}style={'{{'} flex: <span style={{ color: '#e8a0c0' }}>1</span> {'}}'}
            {'\n          '}/&gt;
            {'\n        </'}
            <span style={{ color: '#6fe0d2' }}>div</span>&gt;
            {'\n        <'}
            <span style={{ color: '#6fe0d2' }}>Timeline</span> fps={'{'}<span style={{ color: '#e8a0c0' }}>30</span>{'}'} style={'{{'} height: <span style={{ color: '#e8a0c0' }}>240</span> {'}}'} /&gt;
            {'\n      </'}
            <span style={{ color: '#6fe0d2' }}>div</span>&gt;
            {'\n    </'}
            <span style={{ color: '#6fe0d2' }}>EditorProvider</span>&gt;
            {'\n  )\n'}
            {'}'}
          </pre>
        </div>
      </div>
    </section>
  )
}

export function Faq() {
  return (
    <section style={{ borderTop: '1px solid var(--line2)' }}>
      <div style={{ maxWidth: 780, margin: '0 auto', padding: sectionPad }}>
        <div style={eyebrow}>05 — FAQ</div>
        <h2 style={{ ...heading, margin: '14px 0 28px', ...reveal() }}>Common questions.</h2>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {faq.map((item) => (
            <details key={item.q} style={{ borderBottom: '1px solid var(--line2)', ...reveal('entry 0% entry 40%') }}>
              <summary
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  padding: '19px 0',
                  fontWeight: 500,
                  fontSize: 15.5,
                  letterSpacing: '-0.01em',
                }}
              >
                {item.q}
                <span
                  className="lv-faq-caret"
                  style={{ color: 'var(--accent)', fontSize: 19, transition: 'transform .18s', flexShrink: 0, lineHeight: 1 }}
                >
                  +
                </span>
              </summary>
              <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.7, margin: '0 0 20px', maxWidth: 640, textWrap: 'pretty' }}>
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

export function Cta() {
  return (
    <section style={{ borderTop: '1px solid var(--line2)', position: 'relative', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(700px 340px at 50% 120%, color-mix(in oklab, var(--accent) 14%, transparent), transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          maxWidth: 780,
          margin: '0 auto',
          padding: 'clamp(72px, 11vw, 120px) 24px',
          textAlign: 'center',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 22,
          ...reveal('entry 0% entry 35%'),
        }}
      >
        <div style={eyebrow}>READY TO BUILD</div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(27px,5vw,52px)', letterSpacing: '-0.02em', margin: 0, fontWeight: 600, textWrap: 'balance' }}>
          Start building professional video tooling on the web.
        </h2>
        <p style={{ color: 'var(--muted)', fontSize: 16, margin: 0, maxWidth: 480, lineHeight: 1.6 }}>
          elah is open source. Drop in the timeline and preview components, wire your demuxer, and ship.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <a
            href={GET_STARTED_URL}
            className="lv-accent-btn"
            style={{
              background: 'var(--accent)',
              color: 'var(--ink)',
              fontWeight: 600,
              fontSize: 'clamp(13px, 1.6vw, 14px)',
              padding: '11px 20px',
              borderRadius: 9,
              boxShadow: '0 0 24px color-mix(in oklab, var(--accent) 32%, transparent)',
            }}
          >
            Get Started
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="lv-outline"
            style={{
              border: '1px solid var(--line)',
              background: 'var(--card)',
              color: 'var(--text)',
              fontWeight: 500,
              fontSize: 'clamp(13px, 1.6vw, 14px)',
              padding: '11px 20px',
              borderRadius: 9,
            }}
          >
            View on GitHub
          </a>
        </div>
        <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 12.5, color: 'var(--faint)' }}>
          <span style={{ color: 'var(--accent)' }}>$</span> npx @elah/cli serve
        </span>
      </div>
    </section>
  )
}
