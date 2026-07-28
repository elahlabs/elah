import type { CSSProperties } from 'react'
import { Icon } from './Icon'
import { tracks, type TrackClip } from './landingData'

// A static, decorative reproduction of /playground/production, pinned dark in
// both themes (it depicts a dark tool surface). Colours are intentionally
// literal — this is a product screenshot rendered in markup, not a themed

const MONO = "var(--font-geist-mono), 'Geist Mono', monospace"

const railItems = [
  { icon: 'movie', label: 'Videos', active: true, color: undefined as string | undefined },
  { icon: 'image', label: 'Photos', active: false, color: '#9ca3af' },
  { icon: 'auto_awesome', label: 'Agentic AI', active: false, color: '#ff6b6b' },
  { icon: 'music_note', label: 'Audio', active: false, color: '#9ca3af' },
  { icon: 'title', label: 'Elements', active: false, color: '#9ca3af' },
]

const thumbnails = [
  { grad: 'linear-gradient(135deg,#1e3a8a,#0ea5e9)', dur: '00:12', name: 'intro.mp4', selected: true },
  { grad: 'linear-gradient(135deg,#312e81,#7c3aed)', dur: '00:34', name: 'b-roll-city.mp4', selected: false },
  { grad: 'linear-gradient(135deg,#0f766e,#10b981)', dur: '00:04', name: 'logo-sting.mp4', selected: false },
  { grad: 'linear-gradient(135deg,#7c2d12,#ea580c)', dur: '00:08', name: 'outro.mp4', selected: false },
]

function CornerHandles({ size = 7, offset = -4 }: { size?: number; offset?: number }) {
  const base: CSSProperties = {
    position: 'absolute',
    width: size,
    height: size,
    background: '#fff',
    border: '1px solid #4c9aff',
  }
  return (
    <>
      <span style={{ ...base, left: offset, top: offset }} />
      <span style={{ ...base, right: offset, top: offset }} />
      <span style={{ ...base, left: offset, bottom: offset }} />
      <span style={{ ...base, right: offset, bottom: offset }} />
    </>
  )
}

function Clip({ c, mobile }: { c: TrackClip; mobile?: boolean }) {
  return (
    <span
      style={{
        position: 'absolute',
        top: mobile ? 2.5 : 3,
        bottom: mobile ? 2.5 : 3,
        left: c.left,
        width: c.width,
        borderRadius: mobile ? 4 : 5,
        background: c.bg,
        border: `1px solid ${c.border}`,
        boxShadow: mobile ? undefined : c.shadow,
        display: 'flex',
        alignItems: 'center',
        padding: mobile ? '0 5px' : '0 7px',
        overflow: 'hidden',
      }}
    >
      {c.wave && (
        <span
          style={{
            position: 'absolute',
            inset: mobile ? '5px 3px' : '6px 4px',
            background: `repeating-linear-gradient(90deg, ${c.waveColor} 0 2px, transparent 2px 5px)`,
            opacity: 0.85,
            borderRadius: 2,
          }}
        />
      )}
      <span
        style={{
          position: 'relative',
          fontSize: mobile ? 7.5 : 8.5,
          color: 'rgba(255,255,255,.95)',
          whiteSpace: 'nowrap',
          textShadow: '0 1px 2px rgba(0,0,0,.45)',
        }}
      >
        {c.label}
      </span>
    </span>
  )
}

function DesktopMockup() {
  return (
    <div
      data-lv-desktop
      style={{
        position: 'relative',
        minWidth: 860,
        border: '1px solid #232938',
        borderRadius: 12,
        background: '#06070a',
        boxShadow: '0 50px 140px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.04)',
        overflow: 'hidden',
        color: '#f3f4f6',
        fontSize: 12,
        textAlign: 'left',
      }}
    >
      {/* app header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          height: 46,
          padding: '0 14px',
          background: '#0a0d14',
          borderBottom: '1px solid #232938',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: MONO, fontSize: 11, color: '#9ca3af' }}>← Playgrounds</span>
          <span style={{ width: 1, height: 16, background: '#232938' }} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: '#00c2ff',
                boxShadow: '0 0 8px rgba(0,194,255,.5)',
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.02em' }}>elah</span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: '#9ca3af' }}>@elah/editor</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['undo', 'redo'].map((n) => (
            <span
              key={n}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 30,
                height: 26,
                background: '#171d2b',
                border: '1px solid #232938',
                borderRadius: 6,
                color: '#9ca3af',
              }}
            >
              <Icon name={n} size={15} />
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 10px',
              background: '#171d2b',
              border: '1px solid #232938',
              borderRadius: 6,
              color: '#9ca3af',
              fontSize: 11,
            }}
          >
            <Icon name="code" size={14} />
            Code
          </span>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 12px',
              background: '#00c2ff',
              borderRadius: 6,
              color: '#04202a',
              fontSize: 11,
              fontWeight: 600,
              boxShadow: '0 0 10px rgba(0,194,255,.35)',
            }}
          >
            ⬇ Export
          </span>
          <span
            style={{
              padding: '5px 10px',
              background: '#171d2b',
              border: '1px solid #232938',
              borderRadius: 6,
              color: '#9ca3af',
              fontSize: 11,
            }}
          >
            Trace
          </span>
        </div>
      </div>

      {/* workspace */}
      <div style={{ display: 'flex', height: 330 }}>
        {/* icon rail */}
        <div
          style={{
            width: 58,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 9,
            padding: '10px 0',
            borderRight: '1px solid #232938',
            background: '#06070a',
          }}
        >
          {railItems.map((r) => (
            <span
              key={r.label}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: r.color }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 36,
                  height: 36,
                  borderRadius: 11,
                  background: r.active
                    ? 'linear-gradient(160deg, rgba(0,194,255,.5), rgba(0,194,255,.1))'
                    : undefined,
                  color: r.active ? '#fff' : undefined,
                }}
              >
                <Icon name={r.icon} size={17} />
              </span>
              <span style={{ fontSize: 9, fontWeight: r.active ? 600 : undefined }}>{r.label}</span>
            </span>
          ))}
        </div>

        {/* media panel */}
        <div
          style={{
            width: 206,
            flexShrink: 0,
            borderRight: '1px solid #232938',
            background: '#121722',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '9px 12px',
              borderBottom: '1px solid #232938',
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600 }}>Videos</span>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                background: '#00c2ff',
                color: '#04202a',
                fontSize: 10,
                fontWeight: 600,
                borderRadius: 6,
                padding: '3px 8px',
              }}
            >
              <Icon name="add" size={12} weight={500} />
              Upload
            </span>
          </div>
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#0a0d14',
                  border: '1px solid #232938',
                  borderRadius: 6,
                  padding: '5px 8px',
                  color: '#7a858b',
                  fontSize: 11,
                }}
              >
                <Icon name="search" size={13} />
                Search videos…
              </span>
              <span style={{ fontSize: 11, color: '#9ca3af', display: 'flex', alignItems: 'center' }}>
                Pixabay
                <Icon name="expand_more" size={14} />
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
              {thumbnails.map((t) => (
                <div key={t.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span
                    style={{
                      position: 'relative',
                      aspectRatio: '16 / 9',
                      borderRadius: 6,
                      border: `1px solid ${t.selected ? '#00c2ff' : '#232938'}`,
                      boxShadow: t.selected ? '0 0 0 1px #00c2ff' : undefined,
                      background: t.grad,
                      display: 'block',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        bottom: 3,
                        right: 3,
                        background: 'rgba(0,0,0,.7)',
                        color: '#fff',
                        fontFamily: MONO,
                        fontSize: 8,
                        borderRadius: 3,
                        padding: '1px 4px',
                      }}
                    >
                      {t.dur}
                    </span>
                  </span>
                  <span style={{ fontSize: 10, color: t.selected ? '#f3f4f6' : '#9ca3af' }}>{t.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* preview column */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#000' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 4, padding: '7px 0' }}>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 11px',
                borderRadius: 6,
                background: '#171d2b',
                boxShadow: 'inset 0 0 0 1px #00c2ff',
                fontSize: 11,
              }}
            >
              <span style={{ width: 13, height: 8, borderRadius: 2, background: 'currentColor' }} />
              16:9
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 6, color: '#9ca3af', fontSize: 11 }}>
              <span style={{ width: 7, height: 12, borderRadius: 2, background: 'currentColor' }} />
              9:16
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 6, color: '#9ca3af', fontSize: 11 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: 'currentColor' }} />
              1:1
            </span>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0, padding: '4px 18px 12px' }}>
            <div
              style={{
                position: 'relative',
                width: '100%',
                maxWidth: 340,
                aspectRatio: '16 / 9',
                border: '1px solid rgba(0,194,255,.45)',
                boxShadow: '0 0 20px rgba(0,194,255,.08)',
                background: 'radial-gradient(120% 140% at 30% 20%, #14275c, #090d1c 70%)',
                borderRadius: 2,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%,-50%)',
                  border: '1.5px solid #4c9aff',
                  padding: '8px 18px',
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 19, letterSpacing: '-0.01em', color: '#fff', whiteSpace: 'nowrap' }}>
                  Launch Day
                </span>
                <CornerHandles />
              </div>
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              alignItems: 'center',
              height: 40,
              padding: '0 14px',
              background: '#0a0d14',
              borderTop: '1px solid #232938',
            }}
          >
            <span style={{ fontFamily: MONO, fontSize: 10.5 }}>
              <span style={{ color: '#00c2ff' }}>00:00:02:15</span>
              <span style={{ color: '#9ca3af' }}> | 00:00:12:00</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  background: '#fff',
                  color: '#000',
                }}
              >
                <Icon name="play_arrow" size={17} fill={1} />
              </span>
              <Icon name="stop" size={13} fill={1} color="#9ca3af" />
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', color: '#9ca3af' }}>
              <Icon name="fullscreen" size={14} />
              <span style={{ display: 'flex', alignItems: 'center', gap: 2, border: '1px solid #232938', borderRadius: 5, padding: '2px 7px', fontSize: 10.5 }}>
                Fit
                <Icon name="expand_more" size={12} />
              </span>
              <Icon name="crop_landscape" size={14} />
            </span>
          </div>
        </div>

        {/* properties panel */}
        <div
          style={{
            width: 196,
            flexShrink: 0,
            borderLeft: '1px solid #232938',
            background: '#121722',
            display: 'flex',
            flexDirection: 'column',
            fontSize: 11,
          }}
        >
          <div style={{ padding: '9px 12px', borderBottom: '1px solid #232938', fontSize: 12, fontWeight: 600 }}>
            Clip Properties
          </div>
          <div style={{ padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.12em', color: '#7a858b' }}>TRANSFORM</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {[
                ['X', '960'],
                ['Y', '540'],
                ['Scale', '100%'],
                ['Rot', '0°'],
              ].map(([k, v]) => (
                <span
                  key={k}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    background: '#0a0d14',
                    border: '1px solid #232938',
                    borderRadius: 5,
                    padding: '4px 8px',
                  }}
                >
                  <span style={{ color: '#7a858b' }}>{k}</span>
                  <span style={{ fontFamily: MONO }}>{v}</span>
                </span>
              ))}
            </div>
            <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.12em', color: '#7a858b', marginTop: 3 }}>APPEARANCE</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', color: '#9ca3af' }}>
                <span>Opacity</span>
                <span style={{ fontFamily: MONO, color: '#f3f4f6' }}>100%</span>
              </span>
              <span style={{ position: 'relative', height: 3, borderRadius: 2, background: '#232938', display: 'block' }}>
                <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '100%', borderRadius: 2, background: '#00c2ff' }} />
                <span style={{ position: 'absolute', right: -1, top: '50%', transform: 'translateY(-50%)', width: 9, height: 9, borderRadius: '50%', background: '#fff' }} />
              </span>
            </div>
            <span
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: '#0a0d14',
                border: '1px solid #232938',
                borderRadius: 5,
                padding: '4px 8px',
                color: '#9ca3af',
              }}
            >
              Blend · Normal
              <Icon name="expand_more" size={12} />
            </span>
          </div>
        </div>
      </div>

      {/* timeline controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 36,
          padding: '0 12px',
          background: '#0a0d14',
          borderTop: '1px solid #232938',
          color: '#9ca3af',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Icon name="add" size={14} />
            Add Track
            <Icon name="expand_more" size={12} />
          </span>
          <span style={{ width: 1, height: 15, background: '#232938' }} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Icon name="content_cut" size={13} />
            Split
          </span>
          <Icon name="content_copy" size={13} />
          <Icon name="delete" size={13} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11 }}>
          <Icon name="remove" size={14} />
          <span style={{ position: 'relative', width: 80, height: 2, background: '#232938', borderRadius: 2, display: 'block' }}>
            <span style={{ position: 'absolute', left: '38%', top: '50%', transform: 'translateY(-50%)', width: 9, height: 9, borderRadius: '50%', background: '#9ca3af' }} />
          </span>
          <Icon name="add" size={14} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Icon name="fullscreen" size={13} />
            Fit
          </span>
        </div>
      </div>

      {/* timeline */}
      <div style={{ position: 'relative', background: '#0a0d14' }}>
        <div style={{ display: 'flex', height: 20, borderTop: '1px solid #1a1f2b' }}>
          <span style={{ width: 92, flexShrink: 0, background: '#121722', borderRight: '1px solid #1a1f2b' }} />
          <span
            style={{
              flex: 1,
              position: 'relative',
              display: 'flex',
              justifyContent: 'space-between',
              padding: '0 2px',
              fontFamily: MONO,
              fontSize: 8.5,
              color: '#7a858b',
              alignItems: 'center',
              backgroundImage: 'repeating-linear-gradient(90deg, #394146 0 1px, transparent 1px 8.33%)',
            }}
          >
            {['0s', '2s', '4s', '6s', '8s', '10s', '12s', '14s', '16s', '18s', '20s', '22s'].map((t) => (
              <span key={t}>{t}</span>
            ))}
          </span>
        </div>
        {tracks.map((tr) => (
          <div key={tr.name} style={{ display: 'flex', height: 32, borderTop: '1px solid #1a1f2b' }}>
            <span
              style={{
                width: 92,
                flexShrink: 0,
                background: '#0d1017',
                borderRight: '1px solid #1a1f2b',
                display: 'flex',
                alignItems: 'center',
                padding: '0 9px',
                fontSize: 9.5,
                color: '#9ca3af',
              }}
            >
              {tr.name}
            </span>
            <div style={{ flex: 1, position: 'relative', background: '#0a0d14' }}>
              {tr.clips.map((c) => (
                <Clip key={c.label} c={c} />
              ))}
            </div>
          </div>
        ))}
        <span
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 'calc(92px + (100% - 92px) * 0.24)',
            width: 1.5,
            background: '#fff',
            zIndex: 3,
            animation: 'lv-phSweep 16s linear infinite alternate',
          }}
        />
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: 'calc(92px + (100% - 92px) * 0.24)',
            transform: 'translateX(-50%)',
            width: 9,
            height: 9,
            background: '#fff',
            borderRadius: 2,
            zIndex: 3,
            animation: 'lv-phSweep 16s linear infinite alternate',
          }}
        />
      </div>
    </div>
  )
}

function MobileMockup() {
  return (
    <div
      data-lv-mobile
      style={{
        position: 'relative',
        maxWidth: 390,
        margin: '0 auto',
        border: '1px solid #232938',
        borderRadius: 14,
        background: '#06070a',
        boxShadow: '0 30px 80px rgba(0,0,0,.5)',
        overflow: 'hidden',
        color: '#f3f4f6',
        textAlign: 'left',
        fontSize: 11,
      }}
    >
      {/* header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 42,
          padding: '0 10px',
          background: '#0a0d14',
          borderBottom: '1px solid #232938',
        }}
      >
        <span style={{ fontFamily: MONO, fontSize: 10, color: '#9ca3af' }}>← Playgrounds</span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            border: '1px solid #232938',
            background: '#171d2b',
            borderRadius: 8,
            padding: '4px 10px',
            fontSize: 10.5,
          }}
        >
          <span style={{ width: 12, height: 7, borderRadius: 2, background: 'currentColor' }} />
          16:9
          <Icon name="expand_more" size={12} />
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ background: '#00c2ff', color: '#04202a', fontSize: 10, fontWeight: 600, borderRadius: 5, padding: '3px 8px' }}>
            ⬇ Export
          </span>
          <Icon name="more_vert" size={16} color="#9ca3af" />
        </span>
      </div>

      {/* preview */}
      <div style={{ position: 'relative', aspectRatio: '16 / 9', background: 'radial-gradient(120% 140% at 30% 20%, #14275c, #090d1c 70%)' }}>
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', border: '1.5px solid #4c9aff', padding: '6px 14px' }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#fff', whiteSpace: 'nowrap' }}>Launch Day</span>
          <CornerHandles size={6} offset={-3.5} />
        </div>
        {(['tune', 'fullscreen'] as const).map((n, i) => (
          <span
            key={n}
            style={{
              position: 'absolute',
              bottom: 8,
              left: i === 0 ? 8 : undefined,
              right: i === 1 ? 8 : undefined,
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'rgba(0,0,0,.6)',
              border: '1px solid rgba(255,255,255,.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
            }}
          >
            <Icon name={n} size={13} />
          </span>
        ))}
      </div>

      {/* transport */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          height: 38,
          padding: '0 10px',
          background: '#0a0d14',
          borderTop: '1px solid #232938',
        }}
      >
        <span style={{ fontFamily: MONO, fontSize: 9.5 }}>
          <span style={{ color: '#00c2ff' }}>00:02:15</span>
          <span style={{ color: '#9ca3af' }}> | 00:12:00</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 27, height: 27, borderRadius: '50%', background: '#fff', color: '#000' }}>
            <Icon name="play_arrow" size={15} fill={1} />
          </span>
          <Icon name="stop" size={12} fill={1} color="#9ca3af" />
        </span>
        <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, color: '#9ca3af' }}>
          <Icon name="undo" size={14} />
          <Icon name="redo" size={14} />
        </span>
      </div>

      {/* edit toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 34,
          padding: '0 10px',
          background: '#0a0d14',
          borderTop: '1px solid #232938',
          color: '#9ca3af',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ display: 'flex', alignItems: 'center' }}>
            <Icon name="add" size={14} />
            <Icon name="expand_more" size={11} />
          </span>
          <span style={{ width: 1, height: 13, background: '#232938' }} />
          <Icon name="content_cut" size={13} />
          <Icon name="content_copy" size={13} />
          <Icon name="delete" size={13} />
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Icon name="remove" size={14} />
          <Icon name="add" size={14} />
          <Icon name="fullscreen" size={13} />
        </span>
      </div>

      {/* timeline */}
      <div style={{ position: 'relative', background: '#0a0d14' }}>
        <div style={{ display: 'flex', height: 16, borderTop: '1px solid #1a1f2b' }}>
          <span style={{ width: 42, flexShrink: 0, background: '#121722', borderRight: '1px solid #1a1f2b' }} />
          <span
            style={{
              flex: 1,
              display: 'flex',
              justifyContent: 'space-between',
              padding: '0 2px',
              fontFamily: MONO,
              fontSize: 7.5,
              color: '#7a858b',
              alignItems: 'center',
              backgroundImage: 'repeating-linear-gradient(90deg, #394146 0 1px, transparent 1px 16.66%)',
            }}
          >
            {['0s', '4s', '8s', '12s', '16s', '20s'].map((t) => (
              <span key={t}>{t}</span>
            ))}
          </span>
        </div>
        {tracks.map((tr) => (
          <div key={tr.name} style={{ display: 'flex', height: 26, borderTop: '1px solid #1a1f2b' }}>
            <span
              style={{
                width: 42,
                flexShrink: 0,
                background: '#0d1017',
                borderRight: '1px solid #1a1f2b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: MONO,
                fontSize: 8.5,
                color: '#9ca3af',
              }}
            >
              {tr.short}
            </span>
            <div style={{ flex: 1, position: 'relative', background: '#0a0d14' }}>
              {tr.clips.map((c) => (
                <Clip key={c.label} c={c} mobile />
              ))}
            </div>
          </div>
        ))}
        <span style={{ position: 'absolute', top: 0, bottom: 0, left: 'calc(42px + (100% - 42px) * 0.24)', width: 1.5, background: '#fff', zIndex: 3, animation: 'lv-phSweepMobile 16s linear infinite alternate' }} />
        <span style={{ position: 'absolute', top: 1, left: 'calc(42px + (100% - 42px) * 0.24)', transform: 'translateX(-50%)', width: 8, height: 8, background: '#fff', borderRadius: 2, zIndex: 3, animation: 'lv-phSweepMobile 16s linear infinite alternate' }} />
      </div>

      {/* bottom tab bar */}
      <div style={{ display: 'flex', justifyContent: 'space-around', borderTop: '1px solid #232938', background: '#0a0d14', padding: '7px 0 9px' }}>
        {railItems.map((r) => (
          <span key={r.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: r.color ?? '#9ca3af' }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 10, background: '#171d2b' }}>
              <Icon name={r.icon} size={15} />
            </span>
            <span style={{ fontSize: 8.5 }}>{r.label}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export function EditorMockup() {
  return (
    <div
      style={{
        maxWidth: 1200,
        margin: 'clamp(36px, 5vw, 56px) auto 0',
        padding: '0 20px clamp(56px, 8vw, 80px)',
        position: 'relative',
        animation: 'lv-rise .9s cubic-bezier(.2,.7,.2,1) .3s both',
        overflowX: 'auto',
        scrollbarWidth: 'thin',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: '15%',
          right: '15%',
          top: 20,
          bottom: 60,
          background: 'radial-gradient(60% 60% at 50% 40%, color-mix(in oklab, var(--accent) 18%, transparent), transparent 75%)',
          filter: 'blur(40px)',
          pointerEvents: 'none',
          animation: 'lv-glowPulse 5s ease-in-out infinite',
        }}
      />
      <DesktopMockup />
      <MobileMockup />
    </div>
  )
}
