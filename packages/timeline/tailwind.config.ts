import type { Config } from 'tailwindcss'
import preset from '../../tailwind.preset'

const config: Config = {
  presets: [preset],
  content: ['src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
}

export default config
