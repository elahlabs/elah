import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { GITHUB_URL } from '@/config/nav'
import { btnLarge, btnPrimary, btnSecondary, container, h2OnDark, leadOnDark, outline, sectionY } from './ui'

/** Closing call to action. Its colour is the one the footer lets hang into its top edge. */
export function HomeCta() {
  return (
    <section className={`bg-[#6A1A22] ${sectionY}`}>
      <div className={`${container}`}>
        <div className={`mx-auto flex max-w-[860px] flex-col items-center gap-6 rounded-[20px] bg-[#FFF5F3] px-6 py-10 text-center sm:px-10 ${outline}`}>
        <h2 className={h2OnDark}>Write the motion. Keep the timeline.</h2>
        <p className={`${leadOnDark} max-w-[520px]`}>elah is open source. Open the motion playground, convert a scene to keyframes, and export an mp4 in your browser.</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/playground/motion" className={`${btnPrimary} ${btnLarge}`}>
            Try the motion playground
            <ArrowRight size={16} strokeWidth={2} aria-hidden />
          </Link>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={`${btnSecondary} ${btnLarge}`}>
            View on GitHub
          </a>
        </div>
        </div>
      </div>
    </section>
  )
}
