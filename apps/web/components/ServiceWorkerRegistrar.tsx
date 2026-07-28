'use client'

import { useEffect } from 'react'

// registers after `load` so it never competes with hydration or first paint.
// dev is opt-in: turbopack HMR plus a navigation-intercepting worker produces
// confusing stale reloads, so `next dev` gets no worker unless you ask.
const SW_ENABLED = process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_ENABLE_SW === '1'
const SW_DISABLED = process.env.NEXT_PUBLIC_DISABLE_SW === '1'

// a service worker is sticky — clients that already installed one can't be
// reached by deleting this file (a 404 doesn't unregister it). shipping this
// kill switch from day one is what makes it safe to ever change our minds.
async function unregisterAll() {
  const registrations = await navigator.serviceWorker.getRegistrations()
  await Promise.all(registrations.map((r) => r.unregister()))
  const keys = await caches.keys()
  await Promise.all(keys.filter((k) => k.startsWith('elah-')).map((k) => caches.delete(k)))
}

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    function onLoad() {
      if (SW_DISABLED) {
        unregisterAll().catch(() => {
          // best-effort cleanup — nothing else to do if it fails
        })
        return
      }
      if (!SW_ENABLED) return
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
        // registration failing (e.g. unsupported browser) shouldn't break the page
      })
    }

    window.addEventListener('load', onLoad)
    return () => window.removeEventListener('load', onLoad)
  }, [])

  return null
}
