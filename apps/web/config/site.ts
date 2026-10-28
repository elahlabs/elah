export const siteConfig = {
  name: 'elah',
  description:
    'Framework-agnostic, browser-native video infrastructure. The timeline, rendering, and editing foundation for professional creative applications built entirely on the web. Currently supports Next.js and React, with React Native and more frameworks coming soon.',
  url: 'https://www.elah.dev',
  // Served by app/opengraph-image.tsx (Next file-based metadata route).
  ogImage: 'https://www.elah.dev/opengraph-image',
  links: {
    github: 'https://github.com/elahlabs/elah',
    discord: 'https://discord.gg/qKJXvc4Pwu',
    docs: '/docs',
    playgrounds: '/playgrounds',
  },
  /**
   * Launch switches for /claude (brief section 10a). Launch day is a config
   * change: turn `plugin` on and the plugin card shows its launch state. The
   * artifact was verified inside claude.ai and is live.
   */
  claude: {
    plugin: true,
    artifact: true,
  },
  keywords: [
    'video editor',
    'browser-native',
    'framework-agnostic',
    'WebCodecs',
    'WebGL',
    'timeline',
    'Next.js',
    'React',
    'React Native',
    'TypeScript',
  ],
}

export type SiteConfig = typeof siteConfig
