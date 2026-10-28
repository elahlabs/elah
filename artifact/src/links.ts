/** Every outbound URL in the artifact header lives here. */

/**
 * The founder's single switch for "Try Elah". Today it goes straight to creator's
 * sign-in, where Google sign-in starts the trial. `/login` rather than `/` because
 * creator's `/` redirect drops query strings (the UTM tags).
 */
export const TRY_ELAH_URL = 'https://creator.elahlabs.com/login'
export const GITHUB_URL = 'https://github.com/elahlabs/elah'
export const ELAH_DEV_URL = 'https://www.elah.dev'

/** TRY_ELAH_URL with fixed UTM tags. `source` names the placement; never put user data in it. */
export function tryElahHref(source: 'header' | string = 'header'): string {
  const url = new URL(TRY_ELAH_URL)
  url.searchParams.set('utm_source', 'claude-plugin')
  url.searchParams.set('utm_medium', 'artifact')
  url.searchParams.set('utm_campaign', 'try-elah')
  url.searchParams.set('utm_content', source)
  return url.toString()
}
