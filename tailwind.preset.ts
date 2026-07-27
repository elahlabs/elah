import type { Config } from 'tailwindcss'

/**
 * Shared Tailwind foundation for the whole Elah monorepo: the website
 * (apps/web) and the published packages (@elah/timeline, @elah/editor).
 *
 * Why a preset: every surface authors in the same utility vocabulary and pulls
 * from one set of design tokens. Colors map to CSS variables (never literals) so
 * light/dark and vendor theming happen at runtime, with no rebuild.
 *
 * Two color families coexist deliberately:
 *   - App chrome (marketing/docs): --color-* -> surface, on-surface, primary...
 *   - Editor + packages:           --elah-*  -> ed-*, clip-*, tag-*, playhead...
 *
 * The --elah-* vars resolve from @elah/[pkg]/styles/tokens.css (standalone /
 * vendor) or from the .elah-root mapping in the app's globals.css (so the
 * embedded editor follows the site theme). Either way these utility names work.
 */
const preset = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── App design system (--color-*) ──────────────────────────────────
        surface:              'var(--color-surface)',
        'surface-dim':        'var(--color-surface-dim)',
        'surface-bright':     'var(--color-surface-bright)',
        'surface-lowest':     'var(--color-surface-lowest)',
        'surface-low':        'var(--color-surface-low)',
        'surface-container':  'var(--color-surface-container)',
        'surface-high':       'var(--color-surface-high)',
        'surface-highest':    'var(--color-surface-highest)',
        'on-surface':         'var(--color-on-surface)',
        'on-surface-variant': 'var(--color-on-surface-variant)',
        'inverse-surface':    'var(--color-inverse-surface)',
        'inverse-on-surface': 'var(--color-inverse-on-surface)',
        outline:              'var(--color-outline)',
        'outline-variant':    'var(--color-outline-variant)',
        primary:              'var(--color-primary)',
        'primary-hover':      'var(--color-primary-hover)',
        'primary-dim':        'var(--color-primary-dim)',
        'on-primary':         'var(--color-on-primary)',
        secondary:            'var(--color-secondary)',
        tertiary:             'var(--color-tertiary)',

        // ── Editor / package tokens (--elah-*) ──────────────────────────────
        // Surfaces (ed- namespace avoids collisions with app color names).
        'ed-bg':              'var(--elah-bg)',
        'ed-bg-2':            'var(--elah-bg-secondary)',
        'ed-panel':           'var(--elah-bg-panel)',
        'ed-card':            'var(--elah-bg-card)',
        'ed-elevated':        'var(--elah-bg-elevated)',
        'ed-highest':         'var(--elah-bg-highest)',
        // Borders / text.
        'ed-border':          'var(--elah-border)',
        'ed-border-subtle':   'var(--elah-border-subtle)',
        'ed-outline':         'var(--elah-outline)',
        'ed-text':            'var(--elah-text)',
        'ed-text-muted':      'var(--elah-text-muted)',
        // Accent.
        'ed-accent':          'var(--elah-accent)',
        'ed-accent-hover':    'var(--elah-accent-hover)',
        'ed-accent-dim':      'var(--elah-accent-dim)',
        'ed-accent-glow':     'var(--elah-accent-glow)',
        'ed-accent-soft':     'var(--elah-accent-soft)',
        'ed-accent-text':     'var(--elah-accent-text)',
        // Semantic.
        'ed-error':           'var(--elah-color-error)',
        // Timeline chrome.
        playhead:             'var(--elah-playhead)',
        'tick':               'var(--elah-tick-color)',
        'tick-label':         'var(--elah-tick-label)',
        // Clip color ramps.
        'clip-video-top':     'var(--elah-clip-video-top)',
        'clip-video-mid':     'var(--elah-clip-video-mid)',
        'clip-video-bottom':  'var(--elah-clip-video-bottom)',
        'clip-video-accent':  'var(--elah-clip-video-accent)',
        'clip-audio-top':     'var(--elah-clip-audio-top)',
        'clip-audio-mid':     'var(--elah-clip-audio-mid)',
        'clip-audio-bottom':  'var(--elah-clip-audio-bottom)',
        'clip-audio-accent':  'var(--elah-clip-audio-accent)',
        'clip-text-top':      'var(--elah-clip-text-top)',
        'clip-text-mid':      'var(--elah-clip-text-mid)',
        'clip-text-bottom':   'var(--elah-clip-text-bottom)',
        'clip-text-accent':   'var(--elah-clip-text-accent)',
        'clip-image-top':     'var(--elah-clip-image-top)',
        'clip-image-mid':     'var(--elah-clip-image-mid)',
        'clip-image-bottom':  'var(--elah-clip-image-bottom)',
        'clip-image-accent':  'var(--elah-clip-image-accent)',
        'clip-shape-top':     'var(--elah-clip-shape-top)',
        'clip-shape-mid':     'var(--elah-clip-shape-mid)',
        'clip-shape-bottom':  'var(--elah-clip-shape-bottom)',
        'clip-shape-accent':  'var(--elah-clip-shape-accent)',
        'clip-freehand-top':    'var(--elah-clip-freehand-top)',
        'clip-freehand-mid':    'var(--elah-clip-freehand-mid)',
        'clip-freehand-bottom': 'var(--elah-clip-freehand-bottom)',
        'clip-freehand-accent': 'var(--elah-clip-freehand-accent)',
        // Panel kind/element tags.
        'tag-video-fg':       'var(--elah-tag-video-fg)',
        'tag-video-bg':       'var(--elah-tag-video-bg)',
        'tag-audio-fg':       'var(--elah-tag-audio-fg)',
        'tag-audio-bg':       'var(--elah-tag-audio-bg)',
        'tag-image-fg':       'var(--elah-tag-image-fg)',
        'tag-image-bg':       'var(--elah-tag-image-bg)',
        'tag-text-fg':        'var(--elah-tag-text-fg)',
        'tag-text-bg':        'var(--elah-tag-text-bg)',
        'tag-text-border':    'var(--elah-tag-text-border)',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'JetBrains Mono', 'monospace'],
        body: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '1rem' }],
        xs:    ['0.75rem',  { lineHeight: '1rem' }],
        sm:    ['0.875rem', { lineHeight: '1.25rem' }],
        base:  ['1rem',     { lineHeight: '1.5rem' }],
        lg:    ['1.125rem', { lineHeight: '1.75rem' }],
        xl:    ['1.25rem',  { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem',   { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem',  { lineHeight: '2.5rem' }],
        '5xl': ['3rem',     { lineHeight: '1' }],
        '6xl': ['3.75rem',  { lineHeight: '1' }],
      },
      borderRadius: {
        sm:      '3px',
        DEFAULT: '4px',
        md:      '6px',
        lg:      '8px',
        xl:      '12px',
      },
      boxShadow: {
        card:     '0 1px 2px rgba(28, 27, 27, 0.04)',
        elevated: '0 2px 8px rgba(28, 27, 27, 0.06)',
        none:     'none',
      },
      animation: {
        'fade-in':  'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
      },
      keyframes: {
        fadeIn:  { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
} satisfies Partial<Config>

export default preset
