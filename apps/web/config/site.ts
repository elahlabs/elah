export const siteConfig = {
  name: 'elah',
  description:
    'Framework-agnostic, browser-native video infrastructure. The timeline, rendering, and editing foundation for professional creative applications built entirely on the web. Currently supports Next.js and React, with React Native and more frameworks coming soon.',
  url: 'https://www.elah.dev',
  // Served by app/opengraph-image.tsx (Next file-based metadata route).
  ogImage: 'https://www.elah.dev/opengraph-image',
  links: {
    github: 'https://github.com/elahlabs/elah',
    docs: '/docs',
    playgrounds: '/playgrounds',
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
