import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'
import preset from '../../tailwind.preset'

// Shared tokens (colors, type scale, radii, shadows, motion) live in the
// repo-root preset so the website and the published packages stay in sync.
// This file only adds what's app-specific: content globs, the prose theme,
// and the typography plugin.
const config: Config = {
  presets: [preset],
  // Source is TS/MDX only. Scanning .js would match compiled build artifacts
  // (tsc emits .js next to sources), which breaks incremental rebuilds when
  // those artifacts are cleaned. Keep this to real source extensions.
  content: [
    './pages/**/*.{ts,tsx,mdx}',
    './components/**/*.{ts,tsx,mdx}',
    './app/**/*.{ts,tsx,mdx}',
  ],
  theme: {
    extend: {
      typography: {
        DEFAULT: {
          css: {
            color: 'var(--color-on-surface)',
            '--tw-prose-headings': 'var(--color-on-surface)',
            '--tw-prose-body': 'var(--color-on-surface)',
            '--tw-prose-links': 'var(--color-primary)',
            '--tw-prose-code': 'var(--color-on-surface)',
            '--tw-prose-pre-bg': 'var(--color-surface-container)',
            fontFamily: 'var(--font-inter), system-ui, sans-serif',
            maxWidth: 'none',
            'h1, h2, h3, h4': {
              fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
              fontWeight: '600',
            },
            code: {
              fontFamily: 'var(--font-geist-mono), monospace',
              fontSize: '0.875em',
              backgroundColor: 'var(--color-surface-container)',
              padding: '0.125em 0.3em',
              borderRadius: '3px',
              fontWeight: '400',
            },
            'code::before': { content: '""' },
            'code::after': { content: '""' },
            pre: {
              fontFamily: 'var(--font-geist-mono), monospace',
              borderRadius: '6px',
              border: '1px solid var(--color-outline-variant)',
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
