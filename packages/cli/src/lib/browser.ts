import { CliError } from './errors'
import type { Browser } from 'playwright-core'

export interface LaunchArgs {
  /** Explicit executable path (--browser); wins over discovery. */
  browserPath?: string
  headed?: boolean
}

/**
 * Launch a Chromium-based browser for the export harness. Discovery order:
 * --browser flag → ELAH_BROWSER env → system Chrome → Chrome Beta → Edge.
 * Branded Chrome is preferred because Playwright's bundled Chromium lacks
 * the proprietary codecs (H.264/AAC) that the default export uses.
 *
 * playwright-core is imported lazily so split/trim never load it.
 */
export async function launchBrowser(args: LaunchArgs): Promise<Browser> {
  const { chromium } = await import('playwright-core')

  const explicit = args.browserPath ?? process.env.ELAH_BROWSER
  const attempts: Array<{ executablePath?: string; channel?: string }> = explicit
    ? [{ executablePath: explicit }]
    : [{ channel: 'chrome' }, { channel: 'chrome-beta' }, { channel: 'msedge' }]

  let lastError: Error | undefined
  for (const attempt of attempts) {
    try {
      return await chromium.launch({ ...attempt, headless: !args.headed })
    } catch (err) {
      lastError = err as Error
    }
  }
  throw new CliError(
    'No Chromium-based browser found for export. Install Google Chrome, or pass ' +
      `--browser <path-to-chrome-or-chromium> (or set ELAH_BROWSER). Last error: ${lastError?.message}`
  )
}
