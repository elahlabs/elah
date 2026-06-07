/**
 * TimelineOnlyPage
 *
 * Demonstrates standalone timeline usage with EditorProvider.
 * Validates that @elah/timeline is independently usable.
 *
 * Usage:
 * - Shows a minimal timeline without preview, asset panel, or editor shell
 * - EditorProvider handles engine creation and playback sync
 * - Timeline connects to the shared engine and playback state
 */

import { EditorProvider, Timeline, type InitialTrackConfig } from '@elah/editor'

const INITIAL_TRACKS: InitialTrackConfig[] = [
  { kind: 'video', name: 'Video / Image' },
  { kind: 'audio', name: 'Audio' },
  { kind: 'text', name: 'Text' },
]

export default function TimelineOnlyPage() {
  return (
    <EditorProvider fps={30} initialTracks={INITIAL_TRACKS}>
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            padding: '16px',
            background: '#1a1a1a',
            color: '#fff',
            borderBottom: '1px solid #333',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Timeline Only Demo</h2>
          <p style={{ margin: '8px 0 0 0', fontSize: 12, color: '#999' }}>
            Tests standalone @elah/timeline usage with EditorProvider
          </p>
        </header>

        <Timeline
          fps={30}
          style={{
            flex: 1,
            minHeight: 0,
            background: '#0a0a0a',
            borderTop: '1px solid #333',
          }}
        />
      </div>
    </EditorProvider>
  )
}
