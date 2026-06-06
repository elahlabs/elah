import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
  useSelectionStore,
  useTracksStore,
  useTimelineEngine,
  type Clip,
  type TextAnimationKind,
  type TextAnimation,
} from '@elah/editor'
import { sectionLabel, theme } from './theme'

const FONTS = ['sans-serif', 'serif', 'monospace', 'Georgia', 'Impact']

const inputStyle: CSSProperties = {
  flex: 1,
  background: theme.bgPrimary,
  border: `1px solid ${theme.border}`,
  borderRadius: 6,
  color: theme.textPrimary,
  fontSize: 12,
  fontFamily: theme.fontSans,
  padding: '6px 8px',
  outline: 'none',
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div style={{ borderBottom: `1px solid ${theme.borderSubtle}` }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '10px 14px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          ...sectionLabel,
          color: open ? theme.textSecondary : theme.textMuted,
        }}
      >
        {title}
        <span style={{ fontSize: 10, opacity: 0.7 }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && <div style={{ padding: '0 14px 12px' }}>{children}</div>}
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: theme.textMuted, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}

function AlignBtn({
  value,
  current,
  onClick,
}: {
  value: 'left' | 'center' | 'right'
  current: string
  onClick: () => void
}) {
  const labels: Record<string, string> = { left: '⫷', center: '☰', right: '⫸' }
  const active = current === value
  return (
    <button
      type="button"
      title={`Align ${value}`}
      onClick={onClick}
      style={{
        flex: 1,
        padding: '6px 0',
        fontSize: 13,
        background: active ? 'rgba(225, 29, 72, 0.15)' : theme.bgElevated,
        color: active ? theme.accentHover : theme.textMuted,
        border: `1px solid ${active ? theme.accent : theme.border}`,
        borderRadius: 6,
        cursor: 'pointer',
      }}
    >
      {labels[value]}
    </button>
  )
}

function mergeTransform(c: Partial<Clip>) {
  return { x: 0.5, y: 0.5, scale: 1, rotation: 0, anchor: { x: 0.5, y: 0.5 }, ...c.transform }
}

function mergeAnim(c: Partial<Clip>): TextAnimation {
  return { durationFrames: 15, ...c.textAnimation }
}

function useSelectedTextClip(): Clip | null {
  const selectedClipIds = useSelectionStore((s) => s.selectedClipIds)
  const clips = useTracksStore((s) => s.clips)

  if (selectedClipIds.size !== 1) return null
  const [id] = selectedClipIds
  for (const trackClips of Object.values(clips)) {
    const clip = trackClips.find((c) => c.id === id && c.type === 'text')
    if (clip) return clip
  }
  return null
}

export function TextClipProperties() {
  const engine = useTimelineEngine()
  const clip = useSelectedTextClip()
  const [local, setLocal] = useState<Partial<Clip>>({})

  useEffect(() => {
    if (clip) setLocal({})
  }, [clip?.id])

  const panelShell = (
    <div
      style={{
        width: 300,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: theme.bgPanel,
        borderLeft: `1px solid ${theme.border}`,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '14px 14px 10px',
          borderBottom: `1px solid ${theme.border}`,
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: theme.textPrimary }}>
          {clip ? clip.name : 'Properties'}
        </div>
        {clip && (
          <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 4, fontFamily: theme.fontMono }}>
            Layer · text
          </div>
        )}
      </div>
      {!clip ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            textAlign: 'center',
            fontSize: 12,
            color: theme.textMuted,
          }}
        >
          Select a text clip to edit properties
        </div>
      ) : null}
    </div>
  )

  if (!clip) return panelShell

  const effective = { ...clip, ...local }

  const commit = (updates: Partial<Clip>) => {
    setLocal((prev) => ({ ...prev, ...updates }))
    engine.updateClip(clip.id, clip.trackId, updates)
  }

  const startSec = (clip.startFrame / 30).toFixed(0)
  const endSec = ((clip.startFrame + clip.durationFrames) / 30).toFixed(0)

  return (
    <div
      style={{
        width: 300,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: theme.bgPanel,
        borderLeft: `1px solid ${theme.border}`,
        overflow: 'auto',
      }}
    >
      <div
        style={{
          padding: '14px 14px 10px',
          borderBottom: `1px solid ${theme.border}`,
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: theme.textPrimary }}>{clip.name}</div>
        <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 4, fontFamily: theme.fontMono }}>
          0:{startSec.padStart(2, '0')} – 0:{endSec.padStart(2, '0')}
        </div>
      </div>

      <CollapsibleSection title="CONTENT">
        <FieldRow label="Text">
          <textarea
            value={effective.content ?? ''}
            onChange={(e) => setLocal((p) => ({ ...p, content: e.target.value }))}
            onBlur={() =>
              effective.content !== clip.content &&
              commit({ content: effective.content })
            }
            rows={2}
            style={{
              ...inputStyle,
              resize: 'vertical',
              minHeight: 56,
              lineHeight: 1.4,
              borderColor: theme.accent,
            }}
          />
        </FieldRow>
      </CollapsibleSection>

      <CollapsibleSection title="TYPOGRAPHY">
        <FieldRow label="Font Family">
          <select
            value={effective.fontFamily ?? 'sans-serif'}
            onChange={(e) => commit({ fontFamily: e.target.value })}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            {FONTS.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f === 'sans-serif' ? 'Sans Serif' : f}
              </option>
            ))}
          </select>
        </FieldRow>
        <div style={{ display: 'flex', gap: 8 }}>
          <FieldRow label="Weight">
            <select
              value={effective.fontWeight ?? 'normal'}
              onChange={(e) => commit({ fontWeight: e.target.value as 'normal' | 'bold' })}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="normal">Regular</option>
              <option value="bold">Semibold</option>
            </select>
          </FieldRow>
          <FieldRow label="Size">
            <input
              type="number"
              min={6}
              max={4000}
              value={effective.fontSize ?? 48}
              onChange={(e) => setLocal((p) => ({ ...p, fontSize: Number(e.target.value) }))}
              onBlur={() => {
                const v = effective.fontSize ?? 48
                if (v !== (clip.fontSize ?? 48)) commit({ fontSize: v })
              }}
              style={{ ...inputStyle, width: '100%' }}
            />
          </FieldRow>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="STYLE">
        <FieldRow label="Alignment">
          <div style={{ display: 'flex', gap: 4 }}>
            {(['left', 'center', 'right'] as const).map((a) => (
              <AlignBtn
                key={a}
                value={a}
                current={effective.textAlign ?? 'center'}
                onClick={() => commit({ textAlign: a })}
              />
            ))}
          </div>
        </FieldRow>
        <FieldRow label="Fill">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="color"
              value={effective.color ?? '#ffffff'}
              onChange={(e) => commit({ color: e.target.value })}
              style={{
                width: 32,
                height: 28,
                padding: 0,
                border: `1px solid ${theme.border}`,
                borderRadius: 4,
                background: 'none',
                cursor: 'pointer',
              }}
            />
            <input
              type="text"
              value={effective.color ?? '#ffffff'}
              onChange={(e) => setLocal((p) => ({ ...p, color: e.target.value }))}
              onBlur={() => {
                const v = effective.color ?? '#ffffff'
                if (v !== (clip.color ?? '#ffffff')) commit({ color: v })
              }}
              style={{ ...inputStyle, fontFamily: theme.fontMono, flex: 1 }}
            />
          </div>
        </FieldRow>
        <FieldRow label="Opacity">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="range"
              className="elah-range"
              min={0}
              max={1}
              step={0.01}
              value={effective.opacity ?? 1}
              onChange={(e) => commit({ opacity: Number(e.target.value) })}
              style={{ flex: 1 }}
            />
            <span
              style={{
                fontSize: 10,
                color: theme.textMuted,
                fontFamily: theme.fontMono,
                width: 36,
                textAlign: 'right',
              }}
            >
              {Math.round((effective.opacity ?? 1) * 100)}%
            </span>
          </div>
        </FieldRow>
      </CollapsibleSection>

      <CollapsibleSection title="TRANSFORM" defaultOpen={false}>
        <div style={{ display: 'flex', gap: 8 }}>
          <FieldRow label="X (%)">
            <input
              type="number"
              step={1}
              value={Math.round((effective.transform?.x ?? 0.5) * 100)}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  transform: { ...mergeTransform(effective), x: Number(e.target.value) / 100 },
                }))
              }
              onBlur={() => commit({ transform: mergeTransform(effective) })}
              style={inputStyle}
            />
          </FieldRow>
          <FieldRow label="Y (%)">
            <input
              type="number"
              step={1}
              value={Math.round((effective.transform?.y ?? 0.5) * 100)}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  transform: { ...mergeTransform(effective), y: Number(e.target.value) / 100 },
                }))
              }
              onBlur={() => commit({ transform: mergeTransform(effective) })}
              style={inputStyle}
            />
          </FieldRow>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <FieldRow label="Scale">
            <input
              type="number"
              step={0.05}
              min={0.05}
              max={10}
              value={(effective.transform?.scale ?? 1).toFixed(2)}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  transform: { ...mergeTransform(effective), scale: Number(e.target.value) },
                }))
              }
              onBlur={() => commit({ transform: mergeTransform(effective) })}
              style={inputStyle}
            />
          </FieldRow>
          <FieldRow label="Rotation (°)">
            <input
              type="number"
              step={1}
              value={Math.round(((effective.transform?.rotation ?? 0) * 180) / Math.PI)}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  transform: {
                    ...mergeTransform(effective),
                    rotation: (Number(e.target.value) * Math.PI) / 180,
                  },
                }))
              }
              onBlur={() => commit({ transform: mergeTransform(effective) })}
              style={inputStyle}
            />
          </FieldRow>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="ANIMATION" defaultOpen={false}>
        <FieldRow label="Fade In">
          <select
            value={effective.textAnimation?.in ?? 'none'}
            onChange={(e) => {
              const val = e.target.value
              commit({
                textAnimation: {
                  durationFrames: effective.textAnimation?.durationFrames ?? 15,
                  ...effective.textAnimation,
                  in: val === 'none' ? undefined : (val as TextAnimationKind),
                },
              })
            }}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="none">None</option>
            <option value="fade">Fade</option>
          </select>
        </FieldRow>
        <FieldRow label="Fade Out">
          <select
            value={effective.textAnimation?.out ?? 'none'}
            onChange={(e) => {
              const val = e.target.value
              commit({
                textAnimation: {
                  durationFrames: effective.textAnimation?.durationFrames ?? 15,
                  ...effective.textAnimation,
                  out: val === 'none' ? undefined : (val as TextAnimationKind),
                },
              })
            }}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="none">None</option>
            <option value="fade">Fade</option>
          </select>
        </FieldRow>
        {(effective.textAnimation?.in || effective.textAnimation?.out) && (
          <FieldRow label="Duration (frames)">
            <input
              type="number"
              min={1}
              max={clip.durationFrames}
              value={effective.textAnimation?.durationFrames ?? 15}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  textAnimation: { ...mergeAnim(effective), durationFrames: Number(e.target.value) },
                }))
              }
              onBlur={() => commit({ textAnimation: mergeAnim(effective) })}
              style={inputStyle}
            />
          </FieldRow>
        )}
      </CollapsibleSection>
    </div>
  )
}
