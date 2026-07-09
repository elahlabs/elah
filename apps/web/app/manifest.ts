import { type MetadataRoute } from 'next'
import { siteConfig } from '@/config/site'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteConfig.name,
    short_name: siteConfig.name,
    description: siteConfig.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#111010',
    theme_color: '#111010',
    icons: [{ src: '/icon.png', sizes: 'any', type: 'image/png' }],
  }
}
