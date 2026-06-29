/**
 * Legacy playground color palette — kept for reference only.
 * All consumers have been migrated to Tailwind design-token classes.
 * Do not add new CSSProperties exports here; use token classes instead.
 */
export const theme = {
  bgPrimary: '#06070A',
  bgSecondary: '#0D1017',
  bgPanel: '#121722',
  bgElevated: '#171D2B',
  bgTimeline: '#0A0D14',
  border: '#232938',
  borderSubtle: '#1A1F2B',
  textPrimary: '#F3F4F6',
  textSecondary: '#A7AFBF',
  textMuted: '#6B7280',
  accent: '#E11D48',
  accentHover: '#FB7185',
  accentGlow: 'rgba(225, 29, 72, 0.35)',
  success: '#22C55E',
  warning: '#F59E0B',
  info: '#3B82F6',
  purple: '#7C3AED',
  clipVideo: '#2563EB',
  clipAudio: '#16A34A',
  clipText: '#9333EA',
  playhead: '#FF2D55',
  fontSans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontMono: 'ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace',
} as const
