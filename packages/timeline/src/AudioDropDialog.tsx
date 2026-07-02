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
        background: `var(--elah-dialog-overlay)`,
        backdropFilter: 'blur(2px)',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          width: 380,
          maxWidth: '90vw',
          background: `var(--elah-dialog-bg)`,
          border: `1px solid var(--elah-dialog-border)`,
          borderRadius: 12,
          boxShadow: `var(--elah-dialog-shadow)`,
          padding: 22,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 700,
            color: `var(--elah-text)`,
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
            color: `var(--elah-text-muted)`,
          }}
        >
          How should <span style={{ color: `var(--elah-text)`, fontWeight: 600 }}>{assetName}</span>{' '}
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
                border: primary
                  ? `1px solid var(--elah-dialog-primary-border)`
                  : `1px solid var(--elah-dialog-option-border)`,
                background: primary
                  ? `var(--elah-dialog-primary-bg)`
                  : `var(--elah-dialog-option-bg)`,
                color: `var(--elah-text)`,
                transition: 'background 0.12s, border-color 0.12s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = primary
                  ? 'var(--elah-dialog-primary-bg-hover)'
                  : 'var(--elah-dialog-option-bg-hover)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = primary
                  ? 'var(--elah-dialog-primary-bg)'
                  : 'var(--elah-dialog-option-bg)'
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
              <span style={{ fontSize: 11, color: `var(--elah-text-muted)` }}>{hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
