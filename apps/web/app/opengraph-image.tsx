import { ImageResponse } from 'next/og'

// File-based OG image: Next serves this at /opengraph-image and injects
// og:image + twitter:image tags for every route (root segment convention).
export const alt = 'elah — a browser-native, frame-accurate video editing engine for the web'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#111010',
          padding: 72,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              backgroundColor: '#fcf9f8',
            }}
          />
          <div style={{ fontSize: 28, color: '#9b9391', letterSpacing: 4 }}>
            BROWSER-NATIVE VIDEO INFRASTRUCTURE
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 148,
              fontWeight: 700,
              color: '#fcf9f8',
              letterSpacing: -6,
              lineHeight: 1,
            }}
          >
            elah
          </div>
          <div
            style={{
              marginTop: 28,
              fontSize: 38,
              color: '#c9c3c1',
              lineHeight: 1.35,
              maxWidth: 900,
            }}
          >
            A browser-native, frame-accurate video editing engine — in the browser
            and on your server. Same frame, same pixels — always.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid #312d2d',
            paddingTop: 32,
          }}
        >
          <div style={{ fontSize: 28, color: '#9b9391' }}>elah.dev</div>
          <div style={{ fontSize: 28, color: '#9b9391' }}>
            npm install @elah/editor
          </div>
        </div>
      </div>
    ),
    size,
  )
}
