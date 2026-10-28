import type { Config } from 'tailwindcss'
import preset from '../tailwind.preset'

// Utilities are generated for the artifact's own sources and for the playground components it reuses.
const config: Config = {
  presets: [preset],
  content: [
    './src/**/*.{ts,tsx}',
    '../apps/web/components/playground/production/properties/**/*.{ts,tsx}',
    '../apps/web/components/playground/production/curves/**/*.{ts,tsx}',
    '../apps/web/components/playground/shared/TimelineControls.tsx',
    '../packages/*/src/**/*.{ts,tsx}',
  ],
}

export default config
