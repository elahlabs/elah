'use client'

import { Suspense, useEffect, useRef } from 'react'
import Script from 'next/script'
import { usePathname, useSearchParams } from 'next/navigation'
import { useConsent } from '@/components/ConsentProvider'
// Window.rdt is declared globally in lib/analytics.ts

const PIXEL_ID = process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID

// The base pixel script only fires PageVisit once, on load. App Router
// navigations don't reload the page, so route changes need their own
// PageVisit call. useSearchParams() requires a Suspense boundary.
function RedditPixelPageviews() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isFirstLoad = useRef(true)

  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false
      return
    }
    window.rdt?.('track', 'PageVisit')
  }, [pathname, searchParams])

  return null
}

export function RedditPixel() {
  const { consent } = useConsent()

  // Only inject the pixel after explicit opt-in (and when configured). Before
  // consent this renders nothing, so no Reddit request is made.
  if (!PIXEL_ID || consent !== 'granted') return null

  return (
    <>
      <Script id="reddit-pixel" strategy="afterInteractive">
        {`
          !function(w,d){if(!w.rdt){var p=w.rdt=function(){p.sendEvent?p.sendEvent.apply(p,arguments):p.callQueue.push(arguments)};p.callQueue=[];var t=d.createElement("script");t.src="https://www.redditstatic.com/ads/pixel.js",t.async=!0;var s=d.getElementsByTagName("script")[0];s.parentNode.insertBefore(t,s)}}(window,document);
          rdt('init','${PIXEL_ID}');
          rdt('track', 'PageVisit');
        `}
      </Script>
      <Suspense fallback={null}>
        <RedditPixelPageviews />
      </Suspense>
    </>
  )
}
