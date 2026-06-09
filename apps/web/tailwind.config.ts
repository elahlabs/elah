import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // All values reference CSS variables — light/dark switch happens in globals.css
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
        secondary:            'var(--color-secondary)',
        tertiary:             'var(--color-tertiary)',
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
      typography: {
        DEFAULT: {
          css: {
            color:                   'var(--color-on-surface)',
            '--tw-prose-headings':   'var(--color-on-surface)',
            '--tw-prose-body':       'var(--color-on-surface)',
            '--tw-prose-links':      'var(--color-primary)',
            '--tw-prose-code':       'var(--color-on-surface)',
            '--tw-prose-pre-bg':     'var(--color-surface-container)',
            fontFamily:              'var(--font-inter), system-ui, sans-serif',
            maxWidth:                'none',
            'h1, h2, h3, h4': {
              fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
              fontWeight: '600',
            },
            code: {
              fontFamily:      'var(--font-geist-mono), monospace',
              fontSize:        '0.875em',
              backgroundColor: 'var(--color-surface-container)',
              padding:         '0.125em 0.3em',
              borderRadius:    '3px',
              fontWeight:      '400',
            },
            'code::before': { content: '""' },
            'code::after':  { content: '""' },
            pre: {
              fontFamily:      'var(--font-geist-mono), monospace',
              borderRadius:    '6px',
              border:          '1px solid var(--color-outline-variant)',
              backgroundColor: 'var(--color-surface-low)',
            },
          },
        },
      },
    },
  },
  plugins: [typography],
}

export default config
