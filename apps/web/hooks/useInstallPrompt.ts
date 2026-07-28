'use client'

import { useCallback, useEffect, useState } from 'react'
import { trackEventOnce } from '@/lib/analytics'

// not in lib.dom.d.ts — chromium-only, so declare it ourselves. matches the
// existing `declare global` pattern in lib/analytics.ts.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt: () => Promise<void>
}

declare global {
  interface Window {
    __elahInstallPrompt?: BeforeInstallPromptEvent | null
  }
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent
  }
}

const DISMISSED_KEY = 'elah-pwa-install-dismissed-until'
const INSTALLED_KEY = 'elah-pwa-installed'
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000
// avoid billing a ViewContent for a bouncing visitor, and stop the banner
// flashing in at first paint.
const SHOW_DELAY_MS = 8000

export interface UseInstallPromptResult {
  /** True only when a real beforeinstallprompt event is held and the banner is due. */
  canInstall: boolean
  /** Calls the native prompt. Must be invoked directly from a user gesture. */
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>
  /** Hides the banner and snoozes it for SNOOZE_MS. */
  dismiss: () => void
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage may be unavailable (private mode) — choice still applies this session
  }
}

// desktop chrome leaves the installing tab non-standalone, so display-mode
// alone can't tell us "already installed" there — the installed flag from
// `appinstalled` (below) covers that case.
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    nav.standalone === true
  )
}

function isSnoozed(): boolean {
  const until = readStorage(DISMISSED_KEY)
  return until !== null && Date.now() < Number(until)
}

export function useInstallPrompt(): UseInstallPromptResult {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [delayElapsed, setDelayElapsed] = useState(false)

  useEffect(() => {
    setInstalled(isStandalone() || readStorage(INSTALLED_KEY) === '1')
    setDismissed(isSnoozed())

    // the early inline script in <head> (installPromptScript) parks the
    // event before hydration and re-broadcasts it here, since a real
    // beforeinstallprompt can fire before this effect ever runs.
    if (window.__elahInstallPrompt) setPromptEvent(window.__elahInstallPrompt)

    function onPrompt() {
      if (window.__elahInstallPrompt) setPromptEvent(window.__elahInstallPrompt)
    }
    function onInstalled() {
      window.__elahInstallPrompt = null
      writeStorage(INSTALLED_KEY, '1')
      setInstalled(true)
      setPromptEvent(null)
      trackEventOnce('pwa_installed', 'pwa_installed')
    }

    window.addEventListener('elah:installprompt', onPrompt)
    window.addEventListener('elah:appinstalled', onInstalled)
    return () => {
      window.removeEventListener('elah:installprompt', onPrompt)
      window.removeEventListener('elah:appinstalled', onInstalled)
    }
  }, [])

  useEffect(() => {
    if (!promptEvent || installed || dismissed) return
    const timer = setTimeout(() => setDelayElapsed(true), SHOW_DELAY_MS)
    return () => clearTimeout(timer)
  }, [promptEvent, installed, dismissed])

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const event = promptEvent ?? window.__elahInstallPrompt
    if (!event) return 'unavailable'

    // fire synchronously, before any await — the gesture is still live here
    // and won't be once userChoice resolves.
    trackEventOnce('pwa_install_clicked', 'pwa_install_clicked')

    // the event is single-use regardless of outcome.
    window.__elahInstallPrompt = null
    setPromptEvent(null)

    await event.prompt()
    const { outcome } = await event.userChoice
    return outcome
  }, [promptEvent])

  const dismiss = useCallback(() => {
    writeStorage(DISMISSED_KEY, String(Date.now() + SNOOZE_MS))
    setDismissed(true)
  }, [])

  return {
    canInstall: Boolean(promptEvent) && !installed && !dismissed && delayElapsed,
    install,
    dismiss,
  }
}
