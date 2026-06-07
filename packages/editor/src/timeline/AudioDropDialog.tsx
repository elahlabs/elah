import { useAudioDropDialogStore, type AudioDropChoice } from './audioDropDialog.store'

interface ChoiceDef {
  choice: AudioDropChoice
  label: string
  hint: string
  primary?: boolean
}

const CHOICES: ChoiceDef[] = [
  {
    choice: 'both',
    label: 'Video + Audio',
    hint: 'Add the video and its audio on a separate audio track',
    primary: true,
  },
  { choice: 'video-only', label: 'Video only', hint: 'Drop the audio track' },
  { choice: 'audio-only', label: 'Audio only', hint: 'Add just the audio, no video' },
]

/**
 * Full-screen blocking modal shown when a video carrying an audio track is
 * dropped onto the timeline. Mounted once inside <Timeline>. Renders nothing
 * until `useAudioDropDialogStore.request()` opens it; resolves that request
 * when the user picks a placement. No dismiss path — dropping implies intent.
 */
export function AudioDropDialog() {
  const open = useAudioDropDialogStore((s) => s.open)
  const assetName = useAudioDropDialogStore((s) => s.assetName)
  const respond = useAudioDropDialogStore((s) => s.respond)

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose how to add this media"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(5, 7, 12, 0.6)',
        backdropFilter: 'blur(2px)',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          width: 380,
          maxWidth: '90vw',
          background: '#171D2B',
          border: '1px solid #232938',
          borderRadius: 12,
          boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
          padding: 22,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 700,
            color: '#F3F4F6',
            letterSpacing: '-0.01em',
          }}
        >
          This video has audio
        </h2>
        <p
          style={{
            margin: '6px 0 18px',
            fontSize: 12,
            lineHeight: 1.5,
            color: '#9CA3AF',
          }}
        >
          How should{' '}
          <span style={{ color: '#E5E7EB', fontWeight: 600 }}>{assetName}</span>{' '}
          be added to the timeline?
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {CHOICES.map(({ choice, label, hint, primary }) => (
            <button
              key={choice}
              type="button"
              onClick={() => respond(choice)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 2,
                width: '100%',
                padding: '10px 14px',
                textAlign: 'left',
                cursor: 'pointer',
                borderRadius: 8,
                border: primary ? '1px solid #2563EB' : '1px solid #2A3142',
                background: primary ? 'rgba(37, 99, 235, 0.16)' : '#1B2230',
                color: '#F3F4F6',
                transition: 'background 0.12s, border-color 0.12s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = primary
                  ? 'rgba(37, 99, 235, 0.28)'
                  : '#222B3C'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = primary
                  ? 'rgba(37, 99, 235, 0.16)'
                  : '#1B2230'
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
              <span style={{ fontSize: 11, color: '#9CA3AF' }}>{hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
