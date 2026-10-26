import { ExternalLink, Star } from 'lucide-react'
import { ELAH_DEV_URL, GITHUB_URL, tryElahHref } from './links'

const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' } as const

/** "Made with Elah": quiet mark that sits next to the brand. */
export function MadeWithElah() {
  return (
    <a className="made-with" href={ELAH_DEV_URL} {...NEW_TAB} data-testid="made-with-elah" title="Made with Elah, the open-source video engine">
      <span className="lbl-wide">Made with Elah</span><span className="lbl-narrow">Elah</span>
    </a>
  )
}

/** Star on GitHub + Try Elah. Real links only: the viewer opens them in a new tab. They never change the project. */
export function HeaderLinks() {
  return (
    <>
      <a className="btn" href={GITHUB_URL} {...NEW_TAB} data-testid="star-github" aria-label="Star on GitHub" title="Star Elah on GitHub">
        <Star size={14} /> <span className="lbl-wide">Star on GitHub</span>
      </a>
      <a className="btn primary" href={tryElahHref('header')} {...NEW_TAB} data-testid="try-elah" title="Try Elah">
        <ExternalLink size={14} /> <span className="lbl-wide">Try Elah</span><span className="lbl-narrow">Try</span>
      </a>
    </>
  )
}
