import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: '#fcf9f8',
        'surface-dim': '#dcd9d9',
        'surface-bright': '#fcf9f8',
        'surface-lowest': '#ffffff',
        'surface-low': '#f6f3f2',
        'surface-container': '#f0eded',
        'surface-high': '#eae7e7',
        'surface-highest': '#e5e2e1',
        'on-surface': '#1c1b1b',
        'on-surface-variant': '#5b403f',
        'inverse-surface': '#313030',
        'inverse-on-surface': '#f3f0ef',
        outline: '#8f6f6e',
        'outline-variant': '#e4bebc',
        primary: '#b7102a',
        'primary-hover': '#9a0d23',
        secondary: '#485f84',
        tertiary: '#006860',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'JetBrains Mono', 'monospace'],
        body: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '1rem' }],
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
        '5xl': ['3rem', { lineHeight: '1' }],
        '6xl': ['3.75rem', { lineHeight: '1' }],
      },
      borderRadius: {
        sm: '3px',
        DEFAULT: '4px',
        md: '6px',
        lg: '8px',
        xl: '12px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(28, 27, 27, 0.04)',
        elevated: '0 2px 8px rgba(28, 27, 27, 0.06)',
        none: 'none',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      typography: {
        DEFAULT: {
          css: {
            color: '#1c1b1b',
            '--tw-prose-headings': '#1c1b1b',
            '--tw-prose-body': '#1c1b1b',
            '--tw-prose-links': '#b7102a',
            '--tw-prose-code': '#1c1b1b',
            '--tw-prose-pre-bg': '#f0eded',
            fontFamily: 'var(--font-inter), system-ui, sans-serif',
            maxWidth: 'none',
            'h1, h2, h3, h4': {
              fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
              fontWeight: '600',
            },
            code: {
              fontFamily: 'var(--font-geist-mono), monospace',
              fontSize: '0.875em',
              backgroundColor: '#f0eded',
              padding: '0.125em 0.3em',
              borderRadius: '3px',
              fontWeight: '400',
            },
            'code::before': { content: '""' },
            'code::after': { content: '""' },
            pre: {
              fontFamily: 'var(--font-geist-mono), monospace',
              borderRadius: '6px',
              border: '1px solid #e4bebc',
              backgroundColor: '#f6f3f2',
            },
          },
        },
      },
    },
  },
  plugins: [typography],
}

export default config
