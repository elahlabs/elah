'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useConsent } from '@/components/ConsentProvider'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'
import { trackEventOnce } from '@/lib/analytics'
import { bottomBar } from '@/components/bottomBar'

// Routes where a fixed bottom banner would sit on top of the editor's own
// fixed mobile bottom bar (padded with env(safe-area-inset-bottom)).
const SUPPRESSED_PREFIXES = ['/editor', '/playground/']

export function InstallBanner() {
  const { consent } = useConsent()
  const pathname = usePathname()
  const { canInstall, install, dismiss } = useInstallPrompt()

  // Held while consent is unresolved so this never stacks with ConsentBanner,
  // and so the ViewContent impression below isn't fired before the Reddit
  // pixel script even exists (window.rdt is undefined pre-consent).
  const suppressedByConsent = consent === 'unset'
  const suppressedByRoute = SUPPRESSED_PREFIXES.some((prefix) => pathname?.startsWith(prefix))
  const visible = canInstall && !suppressedByConsent && !suppressedByRoute

  useEffect(() => {
    if (!visible) return
    trackEventOnce('pwa_install_prompt_shown', 'pwa_install_prompt_shown')
  }, [visible])

  if (!visible) return null

  async function handleInstall() {
    const outcome = await install()
    if (outcome === 'dismissed') {
      // the browser's own install dialog was cancelled, not our banner —
      // distinct from the "Not now" button below, so it isn't tracked here.
    }
  }

  function handleDismiss() {
    trackEventOnce('pwa_install_dismissed', 'pwa_install_dismissed')
    dismiss()
  }

  return (
    <div role="dialog" aria-label="Install elah" className={bottomBar.root}>
      <div className={bottomBar.inner}>
        <div className={bottomBar.message}>
          <span aria-hidden className={bottomBar.marker} />
          <p className={bottomBar.text}>Install elah for quicker access to your projects, right from your home screen or dock.</p>
        </div>
        <div className={bottomBar.actions}>
          <button type="button" onClick={handleDismiss} className={bottomBar.secondary}>
            Not now
          </button>
          <button type="button" onClick={handleInstall} className={bottomBar.primary}>
            Install app
          </button>
        </div>
      </div>
    </div>
  )
}
